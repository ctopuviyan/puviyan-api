const METRICS = [
  { id: 'ph', outcomeId: 'improved_water_quality', name: 'pH', unit: '—', isDefault: true },
  { id: 'dissolved_oxygen', outcomeId: 'improved_water_quality', name: 'Dissolved Oxygen', unit: 'mg/L', isDefault: true },
  { id: 'bod', outcomeId: 'improved_water_quality', name: 'BOD', unit: 'mg/L', isDefault: true },
  { id: 'turbidity', outcomeId: 'improved_water_quality', name: 'Turbidity', unit: 'NTU', isDefault: false },
  { id: 'tds', outcomeId: 'improved_water_quality', name: 'TDS', unit: 'mg/L', isDefault: false },
  { id: 'total_coliform', outcomeId: 'improved_water_quality', name: 'Total Coliform', unit: 'MPN/100 mL', isDefault: false },
  { id: 'nitrate', outcomeId: 'improved_water_quality', name: 'Nitrate', unit: 'mg/L', isDefault: false },
  { id: 'phosphate', outcomeId: 'improved_water_quality', name: 'Phosphate', unit: 'mg/L', isDefault: false },
  { id: 'storage_capacity', outcomeId: 'increased_storage', name: 'Storage capacity', unit: 'm³', isDefault: true },
  { id: 'days_water_held', outcomeId: 'increased_storage', name: 'Days water is held per year', unit: 'days', isDefault: true },
  { id: 'water_spread_area', outcomeId: 'increased_storage', name: 'Water spread area', unit: 'ha', isDefault: false },
  { id: 'recharge_water_spread_area', outcomeId: 'groundwater_recharge', name: 'Water spread area', unit: 'ha', isDefault: true, calculationKey: 'water_spread_area' },
  { id: 'recharge_days_water_held', outcomeId: 'groundwater_recharge', name: 'Days water is held per year', unit: 'days', isDefault: true, calculationKey: 'days_water_held' },
  { id: 'nearby_well_water_level', outcomeId: 'groundwater_recharge', name: 'Nearby well water level', unit: 'm below ground', isDefault: false },
  { id: 'modelled_recharge', outcomeId: 'groundwater_recharge', name: 'Modelled recharge', unit: 'm³/year', isDefault: false, autoCalculated: true },
  { id: 'flood_incidents', outcomeId: 'reduced_flooding', name: 'Flood incidents per season', unit: 'count', isDefault: true },
  { id: 'max_flood_depth', outcomeId: 'reduced_flooding', name: 'Max flood depth', unit: 'cm', isDefault: false },
  { id: 'days_to_recede', outcomeId: 'reduced_flooding', name: 'Days to recede', unit: 'days', isDefault: false },
  { id: 'bird_species_count', outcomeId: 'biodiversity_habitat', name: 'Bird species count', unit: 'count', isDefault: true },
  { id: 'native_plant_cover', outcomeId: 'biodiversity_habitat', name: 'Native plant cover', unit: '%', isDefault: false },
  { id: 'invasive_weed_cover', outcomeId: 'biodiversity_habitat', name: 'Invasive weed cover', unit: '%', isDefault: false },
  { id: 'households_benefiting', outcomeId: 'community_benefits', name: 'Households benefiting', unit: 'count', isDefault: true },
  { id: 'people_using_water_body', outcomeId: 'community_benefits', name: 'People using the water body', unit: 'count', isDefault: false },
];

const ACTIONS = [
  ['sewage_inflow_stopped', 'Sewage inflow stopped', ['improved_water_quality']],
  ['wastewater_diversion', 'Wastewater diversion', ['improved_water_quality']],
  ['solid_waste_removal', 'Solid waste removal', ['improved_water_quality']],
  ['trash_screen_silt_trap', 'Trash screen / silt trap', ['improved_water_quality']],
  ['invasive_weed_removal', 'Invasive weed removal', ['improved_water_quality']],
  ['floating_wetland', 'Floating wetland / treatment wetland', ['improved_water_quality']],
  ['aeration', 'Aeration', ['improved_water_quality']],
  ['depth_capacity_survey', 'Depth / capacity survey', ['increased_storage']],
  ['desilting', 'Desilting', ['increased_storage', 'groundwater_recharge']],
  ['feeder_channel_restoration', 'Feeder channel restoration', ['increased_storage', 'groundwater_recharge']],
  ['bund_bank_strengthening', 'Bund / bank strengthening', ['increased_storage']],
  ['inlet_outlet_repair', 'Inlet / outlet repair', ['increased_storage']],
  ['encroachment_removal', 'Encroachment removal', ['increased_storage']],
  ['recharge_structure_installation', 'Recharge structure installation', ['groundwater_recharge']],
  ['recharge_structure_maintenance', 'Recharge structure maintenance', ['groundwater_recharge']],
  ['stormwater_channel_clearing', 'Stormwater channel clearing', ['reduced_flooding']],
  ['drain_blockage_removal', 'Drain blockage removal', ['reduced_flooding']],
  ['spillway_overflow_repair', 'Spillway / overflow repair', ['reduced_flooding']],
  ['pre_monsoon_inspection', 'Pre-monsoon inspection', ['reduced_flooding']],
  ['native_planting', 'Native planting', ['biodiversity_habitat']],
  ['bird_island_creation', 'Bird island creation', ['biodiversity_habitat']],
  ['invasive_species_removal', 'Invasive species removal', ['biodiversity_habitat']],
  ['fencing_buffer_zone', 'Fencing / buffer zone', ['biodiversity_habitat']],
  ['walkway_access_path', 'Walkway / access path', ['community_benefits']],
  ['signage_awareness', 'Signage and awareness', ['community_benefits']],
  ['community_cleanup_drive', 'Community clean-up drive', ['community_benefits']],
  ['seating_public_amenities', 'Seating / public amenities', ['community_benefits']],
].map(([id, name, outcomeIds]) => ({ id, name, outcomeIds }));

const OUTCOME_NAMES = {
  improved_water_quality: 'Improved water quality',
  increased_storage: 'Increased storage and availability',
  groundwater_recharge: 'Improved groundwater recharge',
  reduced_flooding: 'Reduced local flooding',
  biodiversity_habitat: 'Biodiversity and habitat',
  community_benefits: 'Community benefits',
};

async function masters(db) {
  const ref = db.collection('waterBodyMasters').doc('default');
  const snapshot = await ref.get();
  const custom = snapshot.exists ? snapshot.data() : {};
  return {
    metrics: Array.isArray(custom.metrics) ? custom.metrics : METRICS,
    actions: Array.isArray(custom.actions) ? custom.actions : ACTIONS,
    outcomeNames: custom.outcomeNames && typeof custom.outcomeNames === 'object' ? custom.outcomeNames : OUTCOME_NAMES,
  };
}

function findMetric(master, outcomeId, metricId) {
  return master.metrics.find(item => item.id === metricId && item.outcomeId === outcomeId);
}

function numberValue(value, label) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    const error = new Error(`${label} must be zero or a positive number.`);
    error.status = 400;
    throw error;
  }
  return parsed;
}

module.exports = { ACTIONS, METRICS, OUTCOME_NAMES, masters, findMetric, numberValue };
