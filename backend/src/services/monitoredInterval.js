const { observe } = require('./workerObservation');
// Records scheduler activity without changing worker transaction logic.
function monitoredInterval(name, callback, delay) {
  let running = false;
  const heartbeat = setInterval(() => { void observe(name, 'heartbeat'); }, 15000);
  heartbeat.unref();
  void observe(name, 'heartbeat');
  return setInterval(async () => {
    if (running) return;
    running = true;
    await observe(name, 'started');
    try { await callback(); await observe(name, 'completed'); }
    catch (error) { await observe(name, 'failed'); console.error(`[${name}] cycle rejected`); }
    finally { running = false; }
  }, delay);
}
module.exports = { monitoredInterval };

