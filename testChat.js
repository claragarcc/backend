const axios = require("axios");
const fs = require("fs");
const path = require("path");
require("dotenv").config(); // Load environment variables from .env file

// --- CONFIGURATION ---
const BACKEND_URL = process.env.VITE_BACKEND_URL || "http://localhost:9000"; // Ensure this matches your backend URL
const MOCK_USER_ID = "681cd8217918fbc4fc7a626f"; // Use the same MOCK_USER_ID as in Interacciones.jsx

// IMPORTANT: Replace these with the actual IDs of your two "Ley de Ohm" exercises
const TEST_EXERCISE_IDS = [
  "6832f72534ce3d55267f86ce" // e.g., "60a1b2c3d4e5f6a7b8c9d0e1"
];

// Your list of questions
const QUESTIONS = [
  "R1 y R2 dado q las dos resistencia forman un divisor de tensión",
  "R1 y R2 dado que se pide la tensión en R2",
  "R1 y R2 por identificar un divisor de tensión",
  "R1 y R2 hacen un divisor de tensión",
  "R1, R2, R3 y R4 porque R5 está cortocircuitada",
  "R1, R2, R3 y R4 porque por R5 no circula corriente",
  "R1, R2, R3 y R4 porque R5 se quita",
  "R1, R3 y R4 porque R2 está en paralelo con la fuente y R5 cortocircuitada",
  "R1, R4 y R5 porque R2 se elimina y R3 también",
  "R1 y R4 dado que R2 está en paralelo con la fuente, R3 en circuito abierto y R5 cortocircuitada",
  "R1, R2 y R3 dado que R2 y R3 están en paralelo y forman un divisor de tensión con R1",
  "R1, R3, R4 y R5 dado que R3 está en circuito abierto",
  "R1, R3, R4 y R5 dado que R3 sobra",
  "R1, R3, R4 y R5 dado que R3 no hace nada",
  "R1, R2 y R4 dado que son las resistencias que forman parte del circuito.",
  "R1, R2 y R4 dado que R2 y R4 están en paralelo y forma un divisor de tensión con R1.",
  "R1, R2 y R4 dado que R3 está en abierto y R5 cortocircuitada",
  "R1, R2 y R4 dado que solo por estas resistencias circula una corriente diferente de cero",
  "R1, R2 y R4 dado que por R3 y por R5 no circula corriente",
  "R1, R2 y R4 dado que R3 y R5 se pueden quitar",
  "R1, R2 y R4 dado que R3 y R5 no influyen para nada en la diferencia de potencial que se pide",
  "R1, R2 y R4 dado que R3 y R5 sobran",
  "R1, R2 y R4 dado que R3 sobra",
  "R1, R2 y R4 dado que R5 sobra",
  "R1, R2 y R4 dado que R3 está en abierto",
  "R1, R2 y R4 dado que R5 cortocircuitada",
  "R1, R2 y R4 dado que por R3 no circula corriente",
  "R1, R2 y R4 dado que por R5 no circula corriente",
  "R1, R2 y R4 dado que R3 se puede quitar",
  "R1, R2 y R4 dado que R5 se puede quitar",
  "R1, R2 y R4 dado que R3 no influye para nada en la diferencia de potencial que se pide",
  "R1, R2 y R4 dado que R5 no influye para nada en la diferencia de potencial que se pide",
  "No lo sé",
  "Todas las resistencias",
  "R1 y R2",
  "R1, R2 y R4",
  "R1, R2, R4 y R5",
  "R1, R2, R3 y R4"
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
      console.error("  No response received. Request details:", error.request);
    } else {
      console.error("  Error message:", error.message);
    }
    throw error;
  }
}

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
      console.error("  No response received. Request details:", error.request);
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

    let currentInteraccionId = null;
    let fullCumulativeConversation = []; // This will hold the true full history for the LLM context

    for (let i = 0; i < QUESTIONS.length; i++) {
      const question = QUESTIONS[i];
      try {
        let responseData;
        if (i === 0) {
          // Start a new conversation for the first question of each exercise
          responseData = await startChat(MOCK_USER_ID, exerciseId, question);
          currentInteraccionId = responseData.interaccionId;
          fullCumulativeConversation = responseData.fullHistory; // Get initial full history
        } else {
          // Continue the existing conversation
          responseData = await sendMessage(currentInteraccionId, question);
          fullCumulativeConversation = responseData.fullHistory; // Update full history
        }

        // Store only the current turn's interaction in the log file
        allTestResults[exerciseId].push({
          turn_number: i + 1,
          user_message: question,
          assistant_response: responseData.assistantMessage
          // If you need to see the full context the LLM received at this point for debugging,
          // you could uncomment the line below, but it would re-introduce the "repetition":
          // full_conversation_snapshot_for_debug: fullCumulativeConversation
        });

      } catch (error) {
        console.error(`Failed to process question "${question}" for exercise ${exerciseId}:`, error.message);
        allTestResults[exerciseId].push({
          turn_number: i + 1,
          user_message: question,
          status: "FAILED",
          error: error.message
        });
      }
    }
    // Save the entire set of interactions for this exercise to its own file
    const fileName = `conversation_exercise_${exerciseId}.json`;
    await saveConversation(exerciseId, allTestResults[exerciseId], fileName);
  }

  console.log("\n==== All Test Conversations Completed ====");
}

// Run the test conversation
runTestConversation();