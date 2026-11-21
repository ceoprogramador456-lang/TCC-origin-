#include <Arduino.h>
#include <WiFi.h>
#include <time.h>
#include "config.h"
#include "sensor.h"
#include "display.h"
#include "wifi_manager.h"
#include "pairing.h"

static uint32_t lastSample;
static uint32_t lastDisplay;
static float lastFlow;
static bool clockStarted = false;

void setup() {
  Serial.begin(115200);
  setupDisplay();
  setupFlowSensor();
  lastSample = millis();
  network::begin();
  pairing::begin();
}

void loop() {
  network::tick();
  if (!clockStarted && WiFi.status() == WL_CONNECTED) {
    configTime(0, 0, "pool.ntp.org", "time.nist.gov");
    clockStarted = true;
  }
  pairing::tick();

  const uint32_t now = millis();
  const uint32_t elapsed = now - lastSample;
  if (elapsed >= SEND_INTERVAL_MS) {
    lastFlow = readFlowRate(elapsed);
    lastSample = now;
    Serial.printf("Vazao: %.2f L/min\n", lastFlow);
    pairing::sendReading(lastFlow);
  }
  if (now - lastDisplay >= 500) {
    lastDisplay = now;
    const bool portal = network::manager.getConfigPortalActive();
    drawStatus(lastFlow, pairing::state.espId, pairing::state.code, pairing::message,
               portal ? network::portalPassword : String());
  }
  delay(1);
}
