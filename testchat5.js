const axios = require("axios");
const fs = require("fs");
const path = require("path");
require("dotenv").config(); // Load environment variables from .env file

// --- CONFIGURATION ---
const BACKEND_URL = process.env.VITE_BACKEND_URL || "http://localhost:9000"; // Ensure this matches your backend URL
const MOCK_USER_ID = "681cd8217918fbc4fc7a626f"; // Use the same MOCK_USER_ID as in Interacciones.jsx

// IMPORTANT: Replace this with the actual ID(s) of your exercise(s)
// If you want to test one exercise, keep only one ID in the array.
const TEST_EXERCISE_IDS = [
  "6832f72534ce3d55267f86d1" // e.g., "60cdef1234567890abcdef" for Ejercicio 2, or Ejercicio 4, 5, 6, 7
];
const titulo = [
  "Ejercicio 5"
]

// Your list of questions (copy the desired list here)
const QUESTIONS = [
  "R1 y R2 porque están conectadas en serie con la fuente",
  "R1 y R2 porque están conectadas en paralelo con la fuente",
  "R1, R2, y R4 porque están conectadas en serie con la fuente",
  "R1, R2 y R4 porque por R3 no pasa corriente",
  "R1, R2 y R4 porque R3 está en circuito abierto",
  "R1, R2, R3 y R4 porque son las resisitencias que forman parte del circuito",
  "R1, R2, R3 y R4 porque todas están conectadas al circuito",
  "R3 porque R1 y R2 se pueden despreciar al estar en serie con la fuente",
  "R1 y R2 porque R3 está en circuito abierto y R4 está en paralelo con la fuente",
  "R4 porque R1 y R2 se pueden despreciar al estar en serie con la fuente y R3 está en circuito abierto",
  "R1 y R2 porque R3 se puede quitar y R4 está en paralelo con la fuente"
];

const CONVERSATION_LOG_DIR = path.join(__dirname, 'test_conversations');
// --- END CONFIGURATION ---

async function startChat(userId, exerciseId, initialMessage) {
  try {
    console.log(`Starting new chat for exercise ${exerciseId} with message: "${initialMessage}"`);
    const response = await axios.post(`${BACKEND_URL}/api/ollama/chat/start-exercise`, {
      userId: userId,
      exerciseId: exerciseId,
      userMessage: initialMessage
    });
    console.log("Chat started successfully! ✅");
    return response.data;
  } catch (error) {
    console.error("Error starting chat:");
    if (error.response) {
      console.error("  Response status:", error.response.status);
      console.error("  Response data:", error.response.data);
    } else if (error.request) {
      // This is a timeout or connection issue
      console.error("  No response received. Possible backend/Ollama timeout or connection issue.");
      console.error("  Request details (partial):", error.request.path, error.request.method, error.request._options?.port);
    } else {
      console.error("  Error message:", error.message);
    }
    throw error;
  }
}

// La función sendMessage ya no es necesaria para este modo de operación,
// pero la mantenemos si decides reutilizarla en el futuro.
async function sendMessage(interaccionId, userMessage) {
  try {
    console.log(`Sending message to interaction ${interaccionId}: "${userMessage}"`);
    const response = await axios.post(`${BACKEND_URL}/api/ollama/chat/message`, {
      interaccionId: interaccionId,
      userMessage: userMessage
    });
    console.log("Message sent and conversation updated. ✅");
    return response.data;
  } catch (error) {
    console.error("Error sending message:");
    if (error.response) {
      console.error("  Response status:", error.response.status);
      console.error("  Response data:", error.response.data);
    } else if (error.request) {
      console.error("  No response received. Possible backend/Ollama timeout or connection issue.");
      console.error("  Request details (partial):", error.request.path, error.request.method, error.request._options?.port);
    } else {
      console.error("  Error message:", error.message);
    }
    throw error;
  }
}

async function saveConversation(exerciseId, conversationData, filename) {
  if (!fs.existsSync(CONVERSATION_LOG_DIR)) {
    fs.mkdirSync(CONVERSATION_LOG_DIR);
  }
  const filePath = path.join(CONVERSATION_LOG_DIR, filename);
  try {
    fs.writeFileSync(filePath, JSON.stringify(conversationData, null, 2));
    console.log(`Conversation log for exercise ${exerciseId} saved to ${filePath}`);
  } catch (error) {
    console.error("Error saving conversation to file:", error);
  }
}

async function runTestConversation() {
  const allTestResults = {};

  for (const exerciseId of TEST_EXERCISE_IDS) {
    console.log(`\n==== Testing Exercise ID: ${exerciseId} ====`);
    allTestResults[exerciseId] = [];

    // Iteramos sobre cada pregunta y la tratamos como una nueva interacción
    for (let i = 0; i < QUESTIONS.length; i++) {
      const question = QUESTIONS[i];
      try {
        // SIEMPRE llamamos a startChat para cada pregunta
        const responseData = await startChat(MOCK_USER_ID, exerciseId, question);

        // Almacena solo la pregunta y la respuesta directa en el log
        allTestResults[exerciseId].push({
          turn_number: i + 1, // Esto ahora es el número de pregunta en la lista para este ejercicio
          user_message: question,
          assistant_response: responseData.initialMessage // La primera respuesta del asistente en esta nueva interacción
        });

      } catch (error) {
        console.error(`ERROR: Fallo al procesar la pregunta "${question}" para el ejercicio ${exerciseId}.`);
        allTestResults[exerciseId].push({
          turn_number: i + 1,
          user_message: question,
          status: "FAILED",
          error: error.message || "Error desconocido al iniciar el chat para esta pregunta."
        });
      }
    }
    // Guarda el log de conversación para este ejercicio
    const fileName = `sinenunc_${titulo}_${exerciseId}}new_chats.json`; // Nombre de archivo más descriptivo
    await saveConversation(exerciseId, allTestResults[exerciseId], fileName);
  }

  console.log("\n==== All Test Conversations Completed ====");
}

// Ejecuta la secuencia de prueba
runTestConversation();
