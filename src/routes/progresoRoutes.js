const express = require("express");
const mongoose = require("mongoose");
const Resultado = require("../models/resultado");

const router = express.Router();

// La URL completa será: GET /api/progreso/:userId
router.get("/:userId", async (req, res) => {
    try {
        const { userId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ message: "ID de usuario inválido." });
        }

        // 1. OBTENER TODOS LOS DATOS RELEVANTES
        const todosResultados = await Resultado.find({ usuario_id: userId })
            .sort({ fecha: -1 })
            .populate({ path: 'ejercicio_id', select: 'titulo concepto' })
            .populate({ path: 'interaccion_id', select: 'conversacion' });

        // 2. Si no hay resultados, devolver un estado inicial
        if (todosResultados.length === 0) {
            return res.json({
                interaccionesMedias: 0,
                eficienciaPorConcepto: [],
                resumenSemanal: { ejerciciosCompletados: 0, conceptosDistintos: 0, rachaDias: 0 },
                ultimaSesion: {
                    tituloEjercicio: "¡Bienvenido!",
                    analisis: "Aún no has completado ningún ejercicio.",
                    consejo: "Empieza con uno para ver aquí tu progreso."
                }
            });
        }

        // 3. CALCULAR MÉTRICAS
        
        // A) Interacciones Medias
        const totalInteracciones = todosResultados.reduce((sum, r) => sum + (r.interaccion_id?.conversacion.length || 0), 0);
        const interaccionesMedias = todosResultados.length > 0 ? (totalInteracciones / todosResultados.length) : 0;

        // B) Eficiencia por Concepto
        const eficiencia = {};
        todosResultados.forEach(r => {
            if (r.ejercicio_id?.concepto && r.interaccion_id) {
                const concepto = r.ejercicio_id.concepto;
                if (!eficiencia[concepto]) eficiencia[concepto] = { totalInteracciones: 0, count: 0 };
                eficiencia[concepto].totalInteracciones += r.interaccion_id.conversacion.length;
                eficiencia[concepto].count += 1;
            }
        });
        const eficienciaPorConcepto = Object.keys(eficiencia).map(c => ({ concepto: c, interacciones: eficiencia[c].totalInteracciones / eficiencia[c].count }));
        
        // C) Resumen Semanal
        const hoy = new Date();
        const haceUnaSemana = new Date().setDate(hoy.getDate() - 7);
        const resultadosSemana = todosResultados.filter(r => r.fecha >= haceUnaSemana);
        const conceptosSemana = new Set(resultadosSemana.map(r => r.ejercicio_id?.concepto).filter(Boolean));
        const resumenSemanal = {
            ejerciciosCompletados: resultadosSemana.length,
            conceptosDistintos: conceptosSemana.size,
            rachaDias: 0 // La lógica de racha es más compleja y se puede añadir después
        };
        
        // D) Resumen de la Última Sesión
        const ultimoResultado = todosResultados[0];
        const ultimaSesion = {
            tituloEjercicio: ultimoResultado.ejercicio_id?.titulo || "Ejercicio Reciente",
            analisis: ultimoResultado.analisisIA || "Análisis no disponible.",
            consejo: ultimoResultado.consejoIA || "Sigue practicando."
        };

        // 4. DEVOLVER EL OBJETO COMPLETO
        res.status(200).json({
            interaccionesMedias,
            eficienciaPorConcepto,
            resumenSemanal,
            ultimaSesion
        });

    } catch (error) {
        console.error("Error al generar progreso:", error);
        res.status(500).json({ message: "Error en el servidor." });
    }
});

module.exports = router;