/**
 * The roads buses drive on (drive.bin), from OpenStreetMap's ways as Overpass
 * returns them with `out geom`: every public road with its class and its
 * one-way rule, tunnels and the expressways included. The pipeline routes
 * each line along them from stop to stop, so the map draws the road the bus
 * takes instead of straight lines between the stops.
 *
 * The file has the format of walk.bin; an edge's kind packs its direction
 * (0 both ways, 1 only from its first node to its last, 2 only the other way),
 * its class and how far right of the road's middle a bus keeps, in decimetres:
 * direction + class × 4 + side × 32.
 */

// The road classes and their speeds, and how an edge's kind packs them, are the engine's:
// the app drives a car along the same roads.
import { BACKWARD, BOTH_WAYS, FORWARD, roadDirection } from '@madeirabus/engine';
export {
  BACKWARD,
  BOTH_WAYS,
  FORWARD,
  ROAD_SPEED_KMH,
  roadClass,
  roadDirection,
  roadSide,
} from '@madeirabus/engine';

/** A lane of each class of road, when OpenStreetMap does not give the road's width (m). */
export const LANE_WIDTH_M = [3.5, 3.3, 3.2, 3.0, 2.8, 2.6, 3.2];

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
/** The class of a road for cars (an index of ROAD_SPEED_KMH), or undefined for other ways. */
export const highwayClass = (highway: string | undefined) => CLASS[highway ?? ''];

/** Service roads a bus does not take. */
const PRIVATE_SERVICE = new Set(['parking_aisle', 'driveway', 'drive-through', 'emergency_access']);
const NO_ACCESS = new Set(['no', 'private', 'military', 'agricultural', 'forestry', 'delivery']);
const BUS_YES = new Set(['yes', 'designated', 'permissive', 'official']);

/** The furthest a lane is kept from the middle of a road (m): what fits in the file's kind. */
const MAX_SIDE = 6.3;

/** A number of metres from a tag like "5", "5.5 m" or "5,5", if it is one. */
function metres(value: string | undefined): number | undefined {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*m?\s*$/.exec(value ?? '');
  return m ? Number(m[1]!.replace(',', '.')) : undefined;
}

/** A road's carriageway: how many lanes, each how wide (m). */
export function carriageway(
  tags: Record<string, string>,
  cls: number,
  oneWay: boolean,
): { lanes: number; lane: number } {
  const lanesTag = Number.parseInt(tags.lanes ?? '', 10);
  const width = metres(tags.width);
  const usableWidth = width !== undefined && width >= 2 && width <= 30 ? width : undefined;
  const typical = LANE_WIDTH_M[cls] ?? 3;
  let lanes: number;
  if (lanesTag >= 1 && lanesTag <= 8) lanes = lanesTag;
  else if (usableWidth !== undefined)
    lanes = Math.max(1, Math.min(4, Math.round(usableWidth / typical)));
  // Untagged: a lane each way on a two-way road (one on a service road), one on a one-way street.
  else lanes = oneWay || cls === 5 ? 1 : 2;
  const lane =
    usableWidth !== undefined ? Math.max(2.2, Math.min(4, usableWidth / lanes)) : typical;
  return { lanes, lane };
}

/**
 * How far right of a road's middle (its line in OpenStreetMap) a bus keeps, in
 * the centre of the rightmost lane (traffic keeps right on Madeira): half a
 * lane on a two-way road with a lane each way, none on a one-way street of one
 * lane. An expressway's carriageways are mapped apart already, one way each,
 * so a bus on one is not shifted again. A narrow two-way road of a single lane
 * is shared, a bus a little to its right.
 */
export function laneSide(tags: Record<string, string>, cls: number, dir: number): number {
  const oneWay = dir !== BOTH_WAYS;
  if (oneWay && cls === 0) return 0;
  const { lanes, lane } = carriageway(tags, cls, oneWay);
  const side = !oneWay && lanes === 1 ? lane / 4 : ((lanes - 1) * lane) / 2;
  return Math.min(MAX_SIDE, Math.round(side * 10) / 10);
}

/** How a bus may take a way (direction, class and side packed), or undefined where it may not. */
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
  const side = Math.round(laneSide(tags, cls, dir) * 10);
  return dir + cls * 4 + side * 32;
}

/** The kind of a way taken the other way round. */
export function reverseDriveKind(kind: number): number {
  const dir = roadDirection(kind);
  return kind - dir + (dir === FORWARD ? BACKWARD : dir === BACKWARD ? FORWARD : dir);
}
