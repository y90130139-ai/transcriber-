"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UNKNOWN_TOPIC = exports.RELATABLE = exports.taxonomy = exports.AXES = void 0;
exports.labelOf = labelOf;
exports.isValidTag = isValidTag;
exports.isAxis = isAxis;
const taxonomy_json_1 = __importDefault(require("./taxonomy.json"));
exports.AXES = ['persona', 'format', 'hook', 'topic'];
const spec = taxonomy_json_1.default;
exports.taxonomy = {
    persona: spec.persona,
    format: spec.format,
    hook: spec.hook,
    topic: spec.topic,
};
/** The topic that is not a subject: any model can be handed one of these, with
 *  the structure kept and the subject swapped for her own world. */
exports.RELATABLE = 'relatable';
/** Nothing said what it was about. Never matched on, never guessed at. */
exports.UNKNOWN_TOPIC = 'unknown';
const index = new Map(exports.AXES.flatMap((axis) => exports.taxonomy[axis].tags.map((tag) => [`${axis}:${tag.id}`, tag])));
/** The human label for a tag id, falling back to the id so nothing renders blank. */
function labelOf(axis, id) {
    return index.get(`${axis}:${id}`)?.label ?? id;
}
function isValidTag(axis, id) {
    return index.has(`${axis}:${id}`);
}
function isAxis(value) {
    return exports.AXES.includes(value);
}
