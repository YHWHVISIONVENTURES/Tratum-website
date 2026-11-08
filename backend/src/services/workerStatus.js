function describeWorker(row, now=Date.now()) {
 const observed=new Date(row.observed_at).getTime();
 const start=row.last_started_at && new Date(row.last_started_at).getTime();
 const finish=row.last_finished_at && new Date(row.last_finished_at).getTime();
 return { ...row, status: !Number.isFinite(observed) || now-observed>60000 ? 'stale'
  : start && (!finish || start>finish) ? 'running'
  : row.last_outcome==='failed' ? 'failed' : row.last_outcome ? 'cycle_returned' : 'waiting' };
}
module.exports={describeWorker};

