const admin = require("firebase-admin");
const mqtt = require("mqtt");
const moment = require("moment-timezone");
require("dotenv").config();

admin.initializeApp({
  credential: admin.credential.cert({
    type: process.env.TYPE,
    project_id: process.env.PROJECT_ID,
    private_key_id: process.env.PRIVATE_KEY_ID,
    private_key: process.env.PRIVATE_KEY,
    client_email: process.env.CLIENT_EMAIL,
    client_id: process.env.CLIENT_ID,
    auth_uri: process.env.AUTH_URI,
    token_uri: process.env.TOKEN_URI,
    auth_provider_x509_cert_url: process.env.AUTH_PROVIDER_X509_CERT_URL,
    client_x509_cert_url: process.env.CLIENT_X509_CERT_URL,
    universe_domain: process.env.UNIVERSE_DOMAIN,
  }),
});

const port = process.env.PORT || "8080";

const db = admin.firestore();

function isMatchingTime(scheduleTime, userTimezone) {
  const currentMoment = moment().tz(userTimezone);
  const scheduledMoment = moment.tz(scheduleTime, "HH:mm", userTimezone);

  return currentMoment.isSame(scheduledMoment, "minute");
}

// Function to handle the Firestore document change
function handleAutomationSnapshot(change, client) {
  const data = change.data();
  if (
    isMatchingTime(data.clock, data.timezone) &&
    data.days.includes(moment().tz(data.timezone).isoWeekday().toString())
  ) {
    const topic = data.path;
    const payload = data.turnOn ? "1" : "0";

    // Perform MQTT push
    client.publish(topic, payload, { retain: true }, (err) => {
      if (err) {
        console.error("Error publishing MQTT message:", err);
      } else {
        console.log("MQTT message published");
      }
    });

    // If automation is not set to repeat, delete it
    if (data.isRepeat === false) {
      change.ref
        .delete()
        .then(() => {
          console.log("Automation deleted");
        })
        .catch((error) => {
          console.error("Error deleting automation:", error);
        });
    }
  }
}

// Function to handle all automations and check if they need to be executed
function handleAllAutomations(client) {
  // Query all automations
  const automationQuery = db.collectionGroup("automation");
  automationQuery
    .get()
    .then((querySnapshot) => {
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        if (
          isMatchingTime(data.clock, data.timezone) &&
          data.days.includes(moment().tz(data.timezone).isoWeekday().toString())
        ) {
          const topic = data.path;
          const payload = data.turnOn ? "1" : "0";

          // Perform MQTT push
          client.publish(topic, payload, { retain: true }, (err) => {
            if (err) {
              console.error("Error publishing MQTT message:", err);
            } else {
              console.log("MQTT message published");
            }
          });

          // If automation is not set to repeat, delete it
          if (data.isRepeat === false) {
            doc.ref
              .delete()
              .then(() => {
                console.log("Automation deleted");
              })
              .catch((error) => {
                console.error("Error deleting automation:", error);
              });
          }
        }
      });
    })
    .catch((error) => {
      console.error("Error getting automations:", error);
    });
}

// Create an MQTT client instance
const client = mqtt.connect({
  port: process.env.MQTT_PORT,
  protocol: process.env.MQTT_PROTOCOL,
  host: process.env.MQTT_HOST,
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
});

// Listen for Firestore document changes
const automationRef = db.collectionGroup("automation");
automationRef.onSnapshot((snapshot) => {
  snapshot.docChanges().forEach((change) => {
    if (change.type === "added" || change.type === "modified") {
      handleAutomationSnapshot(change.doc, client);
    }
  });
});

setInterval(function () {
  if (moment().format("ss") === "00") {
    handleAllAutomations(client);
  }
}, 1000);

// MQTT event listeners for debugging
client.on("connect", () => {
  console.log("MQTT client connected");
});

client.on("error", (error) => {
  console.error("MQTT connection error:", error);
});

client.on("close", () => {
  console.log("MQTT client connection closed");
});

client.on("message", (topic, message) => {
  console.log("Received MQTT message");
  console.log("Topic:", topic);
  console.log("Message:", message.toString());
});

console.log("Listening to Firestore document changes...");
console.log("Performing automation checks at the start of every new minute...");