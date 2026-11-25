#include <Arduino.h>
#include <WiFi.h>
#include <time.h>
#include <freertos/queue.h>
#include <freertos/task.h>
#include "config.h"
#include "sensor.h"
#include "display.h"
#include "wifi_manager.h"
#include "pairing.h"

static uint32_t lastSample;
static uint32_t lastDisplay;
static float lastFlow;
struct DeviceView {
  char espId[51];
  char code[7];
  const char* message;
};

static QueueHandle_t readings;
static QueueHandle_t deviceViews;
static DeviceView view{{}, {}, "Iniciando"};

static void apiTask(void*) {
  pairing::begin();
  for (;;) {
    pairing::tick();
    float flow;
    if (xQueueReceive(readings, &flow, 0) == pdTRUE) pairing::sendReading(flow);

    DeviceView current{{}, {}, pairing::message};
    pairing::state.espId.toCharArray(current.espId, sizeof(current.espId));
    pairing::state.code.toCharArray(current.code, sizeof(current.code));
    xQueueOverwrite(deviceViews, &current);
    vTaskDelay(pdMS_TO_TICKS(100));
  }
}

void setup() {
  Serial.begin(115200);
  setupDisplay();
  setupFlowSensor();
  lastSample = millis();
  network::begin();
  readings = xQueueCreate(1, sizeof(float));
  deviceViews = xQueueCreate(1, sizeof(DeviceView));
  if (!readings || !deviceViews ||
      xTaskCreate(apiTask, "siva-api", 12288, nullptr, 1, nullptr) != pdPASS) {
    view.message = "Falha tarefa da API";
    Serial.println(view.message);
  }
}

void loop() {
  network::tick();
  static bool wasOnline = false;
  const bool online = WiFi.status() == WL_CONNECTED;
  if (online && !wasOnline) configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  wasOnline = online;

  const uint32_t now = millis();
  const uint32_t elapsed = now - lastSample;
  if (elapsed >= SEND_INTERVAL_MS) {
    lastFlow = readFlowRate(elapsed);
    lastSample = now;
    Serial.printf("Vazao: %.2f L/min\n", lastFlow);
    if (readings && online) xQueueOverwrite(readings, &lastFlow);
  }
  if (now - lastDisplay >= 500) {
    lastDisplay = now;
    if (deviceViews) xQueuePeek(deviceViews, &view, 0);
    drawStatus(lastFlow, view.espId, online ? view.code : "",
               online && !network::storageError ? view.message : network::status());
  }
  delay(1);
}
