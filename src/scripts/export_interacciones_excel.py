import os
import json
from datetime import datetime
from dateutil import parser as dateparser
import certifi

import pandas as pd
from pymongo import MongoClient


# ---------------------------
# CONFIG
# ---------------------------
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
DB_NAME = os.getenv("MONGO_DB", "tutorvirtual")
COLLECTION_NAME = os.getenv("MONGO_COLLECTION", "interaccions")

# opcional: filtrar por fecha (solo si defines DATE_FIELD + START_DATE/END_DATE)
START_DATE = os.getenv("START_DATE", "").strip()
END_DATE = os.getenv("END_DATE", "").strip()
DATE_FIELD = os.getenv("DATE_FIELD", "").strip()

OUTPUT_XLSX = os.getenv(
    "OUTPUT_XLSX",
    f"interacciones_tabla_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
)

# límite para no crear 300 columnas si alguien escribe muchísimo
MAX_TURNOS = int(os.getenv("MAX_TURNOS", "40"))  # turnos = pares U/A aprox


# ---------------------------
# HELPERS
# ---------------------------
def to_iso(dt_value):
    if dt_value is None:
        return None
    if isinstance(dt_value, datetime):
        return dt_value.isoformat()
    if isinstance(dt_value, (int, float)):
        try:
            return datetime.fromtimestamp(dt_value).isoformat()
        except Exception:
            return str(dt_value)
    if isinstance(dt_value, str):
        try:
            return dateparser.parse(dt_value).isoformat()
        except Exception:
            return dt_value
    return str(dt_value)


def json_safe(value):
    return json.dumps(value, ensure_ascii=False, default=str)


def build_query():
    if not (START_DATE or END_DATE) or not DATE_FIELD:
        return {}
    q = {}
    date_filter = {}
    if START_DATE:
        date_filter["$gte"] = dateparser.parse(START_DATE)
    if END_DATE:
        date_filter["$lte"] = dateparser.parse(END_DATE)
    q[DATE_FIELD] = date_filter
    return q


def pick_first(d, keys):
    for k in keys:
        if k in d and d[k] not in (None, ""):
            return d[k]
    return None


# ---------------------------
# DETECCIÓN ROBUSTA DE LISTA DE MENSAJES (aunque esté anidada)
# ---------------------------
def looks_like_message_dict(x: dict) -> bool:
    if not isinstance(x, dict):
        return False
    msg_keys = {
        "role", "content", "text", "message", "mensaje",
        "sender", "author", "from", "timestamp", "createdAt", "ts"
    }
    return any(k in x for k in msg_keys)


def find_messages_recursive(obj, path=""):
    if isinstance(obj, list) and obj:
        if all(isinstance(it, dict) for it in obj) and any(looks_like_message_dict(it) for it in obj):
            return obj, path or "(root_list)"
        for i, it in enumerate(obj[:50]):
            found, found_path = find_messages_recursive(it, f"{path}[{i}]")
            if found:
                return found, found_path

    if isinstance(obj, dict):
        for key in ["messages", "mensajes", "chat", "conversation", "history", "turns"]:
            if key in obj and isinstance(obj[key], list):
                found, found_path = find_messages_recursive(obj[key], f"{path}.{key}" if path else key)
                if found:
                    return found, found_path

        for k, v in obj.items():
            if isinstance(v, (dict, list)):
                found, found_path = find_messages_recursive(v, f"{path}.{k}" if path else k)
                if found:
                    return found, found_path

    return [], None


def get_messages_array(doc):
    return find_messages_recursive(doc)


def normalize_message(msg):
    if not isinstance(msg, dict):
        return {"role": None, "content": str(msg), "timestamp": None, "raw": str(msg)}

    role = pick_first(msg, ["role", "sender", "from", "author", "tipo", "type"])
    content = pick_first(msg, ["content", "text", "message", "mensaje", "respuesta", "output", "input"])
    ts = pick_first(msg, ["timestamp", "time", "date", "createdAt", "ts"])

    return {
        "role": str(role).lower().strip() if role is not None else None,
        "content": str(content) if content is not None else None,
        "timestamp": to_iso(ts),
        "raw": json_safe(msg)
    }


def role_kind(role: str):
    """
    Normaliza roles típicos a USER / ASSISTANT, si no, UNKNOWN.
    """
    if not role:
        return "UNKNOWN"
    r = role.lower()
    if r in ["user", "usuario", "alumno", "student", "human"]:
        return "USER"
    if r in ["assistant", "asistente", "tutor", "ia", "ai", "system"]:
        # ojo: si tienes mensajes "system" y no los quieres en la tabla, luego se filtran
        return "ASSISTANT"
    return "UNKNOWN"


def autosize_worksheet(ws, max_rows_scan=2000, max_width=60):
    ws.freeze_panes = "A2"
    for col_cells in ws.columns:
        header = col_cells[0].value
        max_len = len(str(header)) if header else 10
        for cell in col_cells[1:max_rows_scan]:
            if cell.value is not None:
                max_len = max(max_len, len(str(cell.value)))
        ws.column_dimensions[col_cells[0].column_letter].width = min(max_len + 2, max_width)


def pack_pairs(normalized_msgs):
    """
    Convierte lista de mensajes a pares U/A por orden:
    - Ignora "system" si aparece.
    - Si hay varios seguidos del mismo rol, se concatenan.
    Devuelve lista de pares: [(u_text, a_text), ...]
    """
    # filtrar system si aparece como role literal
    msgs = []
    for m in normalized_msgs:
        rk = role_kind(m.get("role"))
        if m.get("role") and m["role"].lower() == "system":
            continue
        msgs.append({**m, "rk": rk})

    # compactar consecutivos del mismo rol
    compact = []
    for m in msgs:
        txt = (m.get("content") or "").strip()
        if not txt:
            continue
        if compact and compact[-1]["rk"] == m["rk"]:
            compact[-1]["content"] = (compact[-1]["content"] + "\n" + txt).strip()
        else:
            compact.append({"rk": m["rk"], "content": txt})

    pairs = []
    current_user = None

    for m in compact:
        if m["rk"] == "USER":
            # si había un user sin assistant, lo cerramos con assistant vacío
            if current_user is not None:
                pairs.append((current_user, ""))
            current_user = m["content"]
        elif m["rk"] == "ASSISTANT":
            if current_user is None:
                # assistant sin user previo -> lo ponemos como turno 0 con user vacío
                pairs.append(("", m["content"]))
            else:
                pairs.append((current_user, m["content"]))
                current_user = None
        else:
            # UNKNOWN: lo anexamos al bloque anterior si existe, si no, lo metemos en user vacío
            if current_user is not None:
                current_user = (current_user + "\n" + m["content"]).strip()
            elif pairs:
                u, a = pairs[-1]
                pairs[-1] = (u, (a + "\n" + m["content"]).strip() if a else m["content"])
            else:
                pairs.append(("", m["content"]))

    if current_user is not None:
        pairs.append((current_user, ""))

    return pairs


# ---------------------------
# MAIN
# ---------------------------
def main():
    client = MongoClient(MONGO_URI, tlsCAFile=certifi.where())
    client.admin.command("ping")

    col = client[DB_NAME][COLLECTION_NAME]
    query = build_query()

    # 1) Recolectar todas las conversaciones y calcular max nº de pares para construir columnas
    conv_rows = []
    all_pairs = []
    max_pairs = 0

    for doc in col.find(query):
        doc = dict(doc)

        interaccion_id = str(doc.get("_id"))
        usuario_id = str(doc.get("usuario_id")) if doc.get("usuario_id") is not None else None
        ejercicio_id = str(doc.get("ejercicio_id")) if doc.get("ejercicio_id") is not None else None

        inicio = to_iso(doc.get("inicio") or doc.get("createdAt") or doc.get("start"))
        fin = to_iso(doc.get("fin") or doc.get("updatedAt") or doc.get("end"))

        msgs, msgs_path = get_messages_array(doc)

        # fallback: si no hay lista, intenta construirla desde campos típicos
        if not msgs:
            user_text = pick_first(doc, ["input", "pregunta", "mensaje_usuario", "userMessage", "user_message", "prompt"])
            ai_text = pick_first(doc, ["output", "respuesta", "mensaje_ia", "assistantMessage", "assistant_message", "respuesta_ia"])
            built = []
            if user_text:
                built.append({"role": "user", "content": user_text, "timestamp": doc.get("inicio") or doc.get("createdAt")})
            if ai_text:
                built.append({"role": "assistant", "content": ai_text, "timestamp": doc.get("fin") or doc.get("updatedAt")})
            msgs = built
            msgs_path = "fallback_from_fields"

        normalized = [normalize_message(m) for m in msgs]
        pairs = pack_pairs(normalized)

        # limitar para que Excel no explote
        if len(pairs) > MAX_TURNOS:
            pairs = pairs[:MAX_TURNOS]

        max_pairs = max(max_pairs, len(pairs))

        conv_rows.append({
            "interaccion_id": interaccion_id,
            "usuario_id": usuario_id,
            "ejercicio_id": ejercicio_id,
            "inicio": inicio,
            "fin": fin,
            "ruta_mensajes": msgs_path,
            "num_mensajes_raw": len(msgs),
            "num_turnos_user_assistant": len(pairs),
        })
        all_pairs.append((interaccion_id, pairs))

    if not conv_rows:
        raise SystemExit("No se han encontrado documentos para exportar.")

    # 2) Construir tabla “wide”: U1 A1 U2 A2 ...
    wide_rows = []
    for base, (iid, pairs) in zip(conv_rows, all_pairs):
        row = dict(base)
        for i in range(1, max_pairs + 1):
            row[f"U{i}"] = ""
            row[f"A{i}"] = ""
        for i, (u, a) in enumerate(pairs, start=1):
            row[f"U{i}"] = u
            row[f"A{i}"] = a
        wide_rows.append(row)

    df_wide = pd.DataFrame(wide_rows)

    # Orden columnas: metadata + pares
    meta_cols = [
        "interaccion_id", "usuario_id", "ejercicio_id",
        "inicio", "fin", "num_turnos_user_assistant",
        "num_mensajes_raw", "ruta_mensajes"
    ]
    pair_cols = []
    for i in range(1, max_pairs + 1):
        pair_cols.extend([f"U{i}", f"A{i}"])

    ordered_cols = [c for c in meta_cols if c in df_wide.columns] + [c for c in pair_cols if c in df_wide.columns]
    df_wide = df_wide[ordered_cols]

    # 3) Export a Excel
    with pd.ExcelWriter(OUTPUT_XLSX, engine="openpyxl") as writer:
        df_wide.to_excel(writer, index=False, sheet_name="Tabla_Conversacion")

        ws = writer.sheets["Tabla_Conversacion"]
        autosize_worksheet(ws, max_width=80)

    print(f"✅ Excel generado: {OUTPUT_XLSX}")
    print(f"📌 Interacciones: {len(df_wide)} | Máx turnos U/A: {max_pairs} | Colección: {DB_NAME}.{COLLECTION_NAME}")


if __name__ == "__main__":
    main()
