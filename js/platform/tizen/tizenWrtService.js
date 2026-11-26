import { TizenCapabilities } from "./tizenCapabilities.js";

// Tizen 9/10 runtimes export the Service class from wrt:service instead of the
// startService() function documented for older firmware. Service#start() can
// stay pending while the service is already running, so a call still pending
// after the grace window counts as accepted and the caller's health probe
// decides whether the service is reachable.
const SERVICE_START_GRACE_MS = 1500;
const SERVICE_CLASS_MIN_TIZEN_MAJOR = 9;

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

// EngineFS on Tizen 6-8 keeps the start order 1.4.1 used there.
export function getTizenEngineFsStartMethods(options = {}) {
  const { webServiceSupported = null, tizenMajorVersion = 0, hasServiceClass = false } = options;
  if (tizenMajorVersion >= 6 && !hasServiceClass && webServiceSupported !== false) {
    return ["tizen-application-control-default", "tizen-application-launch", "wrt-service"];
  }
  return getTizenServiceStartMethods(options);
}

export function getWrtServiceClass(bridge = globalThis.__NUVIO_TIZEN_WRT_SERVICE__) {
  // Tizen 6 also exports the class, but a service it starts is tied to the app:
  // after playback the exit stayed black for ~20 s (#1610). 1.4.1 launched it there.
  const major = TizenCapabilities.get().tizenMajorVersion || 0;
  if (major > 0 && major < SERVICE_CLASS_MIN_TIZEN_MAJOR) return null;
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
