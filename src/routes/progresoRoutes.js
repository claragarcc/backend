// progresoRoutes.js
const express = require("express");
const mongoose = require("mongoose");
const Resultado = require("../models/resultado");
const Ejercicio = require("../models/ejercicio"); // ✅ IMPORTANTE (lo estabas usando)

const router = express.Router();

// La URL completa será: GET /api/progreso/:userId
router.get("/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "ID de usuario inválido." });
    }

    // 1) OBTENER DATOS
    const todosResultados = await Resultado.find({ usuario_id: userId })
      .sort({ fecha: -1 })
      .populate({ path: "ejercicio_id", select: "titulo concepto" })
      .populate({ path: "interaccion_id", select: "conversacion" });

    // 2) ESTADO INICIAL (si no hay datos) — ✅ con campos que el Dashboard espera
    if (todosResultados.length === 0) {
      return res.json({
        interaccionesMedias: 0,
        eficienciaPorConcepto: [],
        resumenSemanal: {
          ejerciciosCompletados: 0,
          conceptosDistintos: 0,
          rachaDias: 0,
        },
        ultimaSesion: {
          tituloEjercicio: "¡Bienvenido!",
          analisis: "Aún no has completado ningún ejercicio.",
          consejo: "Empieza con uno para ver aquí tu progreso.",
        },

        // ✅ para el Dashboard nuevo
        erroresFrecuentes: [],
        recomendacion: {
          titulo: "",
          motivo:
            "Haz un ejercicio para que el tutor pueda recomendarte una práctica personalizada.",
          ejercicioId: null,
          concepto: "",
        },
      });
    }

    // 3) MÉTRICAS

    // A) Interacciones medias
    const totalInteracciones = todosResultados.reduce(
      (sum, r) => sum + (r.interaccion_id?.conversacion?.length || 0),
      0
    );
    const interaccionesMedias =
      todosResultados.length > 0 ? totalInteracciones / todosResultados.length : 0;

    // B) “Dificultad estimada” por concepto (media de mensajes por ejercicio)
    const eficiencia = {};
    for (const r of todosResultados) {
      if (r.ejercicio_id?.concepto && r.interaccion_id?.conversacion) {
        const concepto = r.ejercicio_id.concepto;
        if (!eficiencia[concepto]) eficiencia[concepto] = { total: 0, count: 0 };
        eficiencia[concepto].total += r.interaccion_id.conversacion.length;
        eficiencia[concepto].count += 1;
      }
    }

    const eficienciaPorConcepto = Object.keys(eficiencia).map((c) => ({
      concepto: c,
      interacciones: eficiencia[c].total / eficiencia[c].count,
    }));

    // C) Resumen semanal (últimos 7 días)
    const hoy = new Date();
    const haceUnaSemana = new Date();
    haceUnaSemana.setDate(hoy.getDate() - 7);

    const resultadosSemana = todosResultados.filter((r) => r.fecha >= haceUnaSemana);
    const conceptosSemana = new Set(
      resultadosSemana.map((r) => r.ejercicio_id?.concepto).filter(Boolean)
    );

    const resumenSemanal = {
      ejerciciosCompletados: resultadosSemana.length,
      conceptosDistintos: conceptosSemana.size,
      rachaDias: 0, // si quieres lo calculamos luego
    };

    // D) Última sesión
    const ultimoResultado = todosResultados[0];
    const ultimaSesion = {
      tituloEjercicio: ultimoResultado.ejercicio_id?.titulo || "Ejercicio Reciente",
      analisis: ultimoResultado.analisisIA || "Análisis no disponible.",
      consejo: ultimoResultado.consejoIA || "Sigue practicando.",
    };

    // E) Errores frecuentes (top 3) — requiere que Resultado tenga campo "errores"
    const mapaErrores = {}; // etiqueta -> { etiqueta, texto, veces }

    for (const r of todosResultados) {
      for (const e of r.errores || []) {
        if (!e?.etiqueta) continue;
        if (!mapaErrores[e.etiqueta]) {
          mapaErrores[e.etiqueta] = {
            etiqueta: e.etiqueta,
            texto: e.texto || e.etiqueta,
            veces: 0,
          };
        }
        mapaErrores[e.etiqueta].veces += 1;
      }
    }

    const erroresFrecuentes = Object.values(mapaErrores)
      .sort((a, b) => b.veces - a.veces)
      .slice(0, 3);

    // F) Recomendación (elige concepto “más difícil” y sugiere un ejercicio)
    let recomendacion = {
      titulo: "",
      motivo:
        "Haz un ejercicio para que el tutor pueda recomendarte una práctica personalizada.",
      ejercicioId: null,
      concepto: "",
    };

    if (eficienciaPorConcepto.length > 0) {
      const peor = [...eficienciaPorConcepto].sort(
        (a, b) => b.interacciones - a.interacciones
      )[0];

      const conceptoObjetivo = peor.concepto;

      const ej = await Ejercicio.findOne({ concepto: conceptoObjetivo }).select(
        "_id titulo concepto"
      );

      if (ej) {
        recomendacion = {
          titulo: ej.titulo || "Ejercicio recomendado",
          motivo: "Te recomiendo reforzar este concepto según tu actividad reciente.",
          ejercicioId: ej._id.toString(),
          concepto: ej.concepto || conceptoObjetivo,
        };
      } else {
        recomendacion = {
          titulo: "Recomendación",
          motivo: `Refuerza el concepto: ${conceptoObjetivo}.`,
          ejercicioId: null,
          concepto: conceptoObjetivo,
        };
      }
    }

    // 4) RESPUESTA FINAL — ✅ todo lo que pinta el Dashboard
    return res.status(200).json({
      interaccionesMedias,
      eficienciaPorConcepto,
      resumenSemanal,
      ultimaSesion,
      erroresFrecuentes,
      recomendacion,
    });
  } catch (error) {
    console.error("Error al generar progreso:", error);
    return res.status(500).json({ message: "Error en el servidor." });
  }
});

module.exports = router;
