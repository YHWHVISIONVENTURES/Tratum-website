function positive(value) {
 return (typeof value==='string' || typeof value==='number') && /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(String(value)) && Number.isFinite(Number(value)) && Number(value)>0;
}
function resolveRail({preferred_rail,corridor,online_state='ONLINE',source_currency,destination_currency,amount,liquidity_health,sourceRails,destinationRails}) {
 if(!positive(amount) || !Number.isFinite(Number(liquidity_health)) || Number(liquidity_health)<=0) throw new Error('INVALID_RAIL_LIQUIDITY_CONTEXT');
 if(!/^[A-Z0-9]{3,12}$/.test(source_currency || '') || !/^[A-Z0-9]{3,12}$/.test(destination_currency || '')) throw new Error('INVALID_RAIL_CURRENCY');
 if(!['ONLINE','OFFLINE'].includes(online_state)) throw new Error('INVALID_CONNECTIVITY_STATE');
 if(!Array.isArray(sourceRails) || !Array.isArray(destinationRails)) throw new Error('COUNTRY_RAIL_CONFIGURATION_REQUIRED');
 const active=rows=>rows.filter(row=>row.active===true && /^[A-Z0-9_:-]{1,64}$/.test(row.rail_code || ''));
 const destination=active(destinationRails);
 let choices=active(sourceRails).filter(row=>destination.some(other=>other.rail_code===row.rail_code));
 choices=choices.filter(row=>online_state==='ONLINE' || row.offline_enabled===true);
 const requested=preferred_rail || corridor?.preferred_rail;
 if(requested) choices=choices.filter(row=>row.rail_code===requested || row.rail_type===requested);
 // Preserve the existing routing preference: PAPSS, CBDC, stablecoin; priority breaks ties.
 const rank=row=>row.rail_code==='PAPSS'?0:row.rail_type==='CBDC'?1:row.rail_type==='STABLECOIN'?2:3;
 choices.sort((a,b)=>rank(a)-rank(b) || Number(b.priority_score || 0)-Number(a.priority_score || 0) || a.rail_code.localeCompare(b.rail_code));
 const selected=choices[0];
 if(!selected) throw new Error('NO_APPROVED_COMMON_RAIL');
 if(typeof selected.settlement_mode!=='string' || !selected.settlement_mode.trim() || selected.estimated_finality===undefined || selected.estimated_finality===null || selected.estimated_finality==='') throw new Error('RAIL_FINALITY_CONFIGURATION_REQUIRED');
 return {rail_code:selected.rail_code,rail_type:selected.rail_type,settlement_mode:selected.settlement_mode,estimated_finality:selected.estimated_finality};
}
module.exports={resolveRail};
