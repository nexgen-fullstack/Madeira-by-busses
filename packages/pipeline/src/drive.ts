/**
 * The roads buses drive on (drive.bin), from OpenStreetMap's ways as Overpass
 * returns them with `out geom`: every public road with its class and its
 * one-way rule, tunnels and the expressways included. The pipeline routes
 * each line along them from stop to stop, so the map draws the road the bus
 * takes instead of straight lines between the stops.
 *
 * The file has the format of walk.bin; an edge's kind is its class × 4 plus
 * its direction: 0 both ways, 1 only from its first node to its last, 2 only
 * the other way.
 */

/** Road classes, fastest first: motorway, primary, secondary, tertiary, minor, service, busway. */
export const ROAD_SPEED_KMH = [75, 50, 42, 35, 28, 14, 40];

const CLASS: Record<string, number> = {
  motorway: 0,
  motorway_link: 0,
  trunk: 0,
  trunk_link: 0,
  primary: 1,
  primary_link: 1,
  secondary: 2,
  secondary_link: 2,
  tertiary: 3,
  tertiary_link: 3,
  unclassified: 4,
  residential: 4,
  road: 4,
  living_street: 5,
  service: 5,
  busway: 6,
  bus_guideway: 6,
};
/** Service roads a bus does not take. */
const PRIVATE_SERVICE = new Set(['parking_aisle', 'driveway', 'drive-through', 'emergency_access']);
const NO_ACCESS = new Set(['no', 'private', 'military', 'agricultural', 'forestry', 'delivery']);
const BUS_YES = new Set(['yes', 'designated', 'permissive', 'official']);

export const BOTH_WAYS = 0;
export const FORWARD = 1;
export const BACKWARD = 2;

/** How a bus may take a way (class × 4 + direction), or undefined where it may not. */
export function driveKind(tags: Record<string, string> = {}): number | undefined {
  const cls = CLASS[tags.highway ?? ''];
  if (cls === undefined || tags.area === 'yes') return undefined;
  if (tags.highway === 'service' && PRIVATE_SERVICE.has(tags.service ?? '')) return undefined;
  const bus = BUS_YES.has(tags.bus ?? '') || BUS_YES.has(tags.psv ?? '');
  const closed = [tags.access, tags.vehicle, tags.motor_vehicle].some(
    (v) => v !== undefined && NO_ACCESS.has(v),
  );
  if (closed && !bus) return undefined;
  if (tags.bus === 'no' || tags.psv === 'no') return undefined;
  const oneway = tags['oneway:bus'] ?? tags['oneway:psv'] ?? tags.oneway;
  let dir = BOTH_WAYS;
  if (oneway === 'no' || tags.busway === 'opposite_lane' || tags.busway === 'opposite') {
    dir = BOTH_WAYS;
  } else if (oneway === '-1' || oneway === 'reverse') {
    dir = BACKWARD;
  } else if (
    oneway === 'yes' ||
    oneway === 'true' ||
    oneway === '1' ||
    tags.junction === 'roundabout' ||
    tags.junction === 'circular' ||
    tags.highway === 'motorway'
  ) {
    dir = FORWARD;
  }
  return cls * 4 + dir;
}

/** The kind of a way taken the other way round. */
export function reverseDriveKind(kind: number): number {
  const dir = kind % 4;
  return kind - dir + (dir === FORWARD ? BACKWARD : dir === BACKWARD ? FORWARD : dir);
}
