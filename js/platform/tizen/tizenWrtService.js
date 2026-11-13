// Tizen 9/10 runtimes export the Service class from wrt:service instead of the
// startService() function documented for older firmware. Service#start() can
// stay pending while the service is already running, so a call still pending
// after the grace window counts as accepted and the caller's health probe
// decides whether the service is reachable.
const SERVICE_START_GRACE_MS = 1500;

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
