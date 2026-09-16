self.Module = self.Module || {};
const pending = [];
let runtimeReady = false;
const previousReady = self.Module.onRuntimeInitialized;
self.Module.onRuntimeInitialized = function () {
  if (typeof previousReady === "function") previousReady();
  runtimeReady = true;
  const handler = self.onmessage;
  pending.splice(0).forEach(data => handler && handler({ data }));
};
importScripts("./encoderWorker.min.js");
const handler = self.onmessage;
self.onmessage = function (event) {
  if (!runtimeReady) pending.push(event.data);
  else handler(event);
};
