// Tizen 9/10 runtimes export the Service class from wrt:service instead of the
// startService() function documented for older firmware. Service#start() can
// stay pending while the service is already running, so a call still pending
// after the grace window counts as accepted and the caller's health probe
// decides whether the service is reachable.
const SERVICE_START_GRACE_MS = 1500;

// Samsung documents wrt:service.startService() as the Web Service API, but
// its TV guidance warns that launchAppControl() can disturb the foreground
// application when the web.service capability is unavailable. Tizen 5.x
// acknowledges a wrt:service start without bringing the service up, so there
// it is launched directly. Tizen 9/10 export only the Service class.
export function getTizenServiceStartMethods({
  webServiceSupported = null,
  tizenMajorVersion = 0,
  tizenMinorVersion = 0,
  hasServiceClass = false
} = {}) {
  // 5.5 acknowledges both wrt:service and the Service class without starting
  // the service, so the firmware rule wins over what the bridge exposes.
  if (tizenMajorVersion === 5 && tizenMinorVersion >= 5) {
    return ["tizen-application-launch", "wrt-service"];
  }
  if (hasServiceClass) {
    return ["wrt-service", "tizen-application-launch"];
  }
  if (webServiceSupported === true) {
    return ["wrt-service", "tizen-application-control-default", "tizen-application-launch"];
  }
  return ["wrt-service", "tizen-application-launch"];
}

// EngineFS on Tizen 6-8 (startService() runtimes) keeps the 1.4.1 order: a
// service started through wrt:service is tied to the app, and on Tizen 6 its
// teardown after playback left the screen black for seconds on exit (#1408).
export function getTizenEngineFsStartMethods(options = {}) {
  const { webServiceSupported = null, tizenMajorVersion = 0, hasServiceClass = false } = options;
  if (tizenMajorVersion >= 6 && !hasServiceClass && webServiceSupported !== false) {
    return ["tizen-application-control-default", "tizen-application-launch", "wrt-service"];
  }
  return getTizenServiceStartMethods(options);
}

export function getWrtServiceClass(bridge = globalThis.__NUVIO_TIZEN_WRT_SERVICE__) {
  const Service = bridge?.Service || bridge?.default?.Service;
  return typeof Service === "function" ? Service : null;
}

export function startWithWrtServiceClass(Service, serviceId, graceMs = SERVICE_START_GRACE_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve("pending"), graceMs);
    Promise.resolve(new Service(serviceId).start()).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
