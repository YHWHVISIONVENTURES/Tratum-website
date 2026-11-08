const { monitoredInterval } = require('../services/monitoredInterval');
const pool = require('../db');
let interval=null;

async function tick() {
  try {
    const r = await pool.query("SELECT COUNT(*) as pending FROM revenue_events WHERE status='PENDING'");
    const pendingCount = parseInt(r.rows[0].pending);

    if (pendingCount > 0) {
      console.warn(`⚠️ [REVENUE ALERT] ${pendingCount} transactions are STUCK in PENDING!`);
      // Future: Trigger Slack/Email Alert here
    } else {
      console.log('[REVENUE] All systems balanced. Pending: 0');
    }
  } catch(err) {
    console.log('[REVENUE WORKER ERROR]', err.message);
  }
}


function start(){
 if(interval) return;
 interval = monitoredInterval('revenueDistributionWorker', tick,30000);
 console.log('[REVENUE WORKER] ACTIVE');
}

module.exports={start};
