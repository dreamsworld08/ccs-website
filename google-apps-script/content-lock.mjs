/**
 * THE LOCK: decides what the admin panel is allowed to write into src/content.
 *
 * One implementation, two users:
 *   - google-apps-script/Code.gs  gets a copy pasted between the GENERATED markers by `npm run rules`
 *   - dev-server/server.mjs       imports this file
 * It is plain ES5 on purpose so it runs unchanged inside Apps Script. Do not "modernise" it.
 *
 * The rules come from src/admin/schemas.ts, the same field list that draws the admin forms, so a field
 * the admin screen does not show cannot be written through the API either:
 *   - only the declared fields are kept; every other key is dropped (no new fields, no layout data)
 *   - types, lengths, allowed options, link schemes, upload paths and list sizes are enforced
 *   - developer-only switches (rules.developerOnly) and fields that can only be chosen when an item is
 *     created (`addOnly`) always keep their stored value, whatever the request says
 *   - singleton files (settings/site.json, home/home.json) cannot be created under another name
 *
 * Returns { ok: true, data } with the cleaned copy to store, or { ok: false, error } for the admin.
 */
export function cleanContent(rules, path, data, current) {
  var parts = String(path).split('/');
  var rule = rules[parts[0]];
  var stem = String(parts[1] || '').replace(/\.json$/, '');
  if (!rule) return { ok: false, error: 'That path is not allowed.' };
  if (rule.files && rule.files.indexOf(stem) < 0) {
    return { ok: false, error: 'That page has a fixed file name and cannot be added to.' };
  }

  var CONTROL = /[\u0000-\u001f\u007f]/g;
  var CONTROL_KEEP_LINES = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
  var LINK = /^(https?:\/\/|\/(?!\/)|#|mailto:|tel:)/i;
  var UPLOAD = /^\/uploads\/[A-Za-z0-9][A-Za-z0-9\/_.-]{0,180}$/;
  var DATE = /^\d{4}-\d{2}-\d{2}$/;
  var DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
  var ID = /^[a-z0-9][a-z0-9_-]{0,80}$/;

  var isObject = function (v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  };
  var fail = function (field, text) {
    return { error: field.label + ' ' + text };
  };

  /** Cleans one value. Returns { value } or { error }. */
  function cleanValue(field, v) {
    var type = field.type;
    var empty = v === '' || v === null || v === undefined;

    if (type === 'checkbox') {
      if (typeof v !== 'boolean') return fail(field, 'must be on or off.');
      return { value: v };
    }

    if (type === 'number') {
      if (empty) return field.required ? fail(field, 'is required.') : { value: '' };
      if (typeof v !== 'number' || !isFinite(v) || Math.abs(v) > 1e9)
        return fail(field, 'must be a number.');
      return { value: v };
    }

    if (type === 'strings') {
      if (!Array.isArray(v)) return fail(field, 'must be a list.');
      if (v.length > (field.maxItems || 20)) return fail(field, 'has too many items.');
      var list = [];
      for (var i = 0; i < v.length; i++) {
        var one = cleanText(
          {
            label: field.label,
            type: 'text',
            max: field.max,
            pattern: field.pattern,
            patternFlags: field.patternFlags,
            patternHelp: field.patternHelp,
          },
          v[i],
        );
        if (one.error) return one;
        list.push(one.value);
      }
      return { value: list };
    }

    if (type === 'objects') {
      if (!Array.isArray(v)) return fail(field, 'must be a list.');
      if (v.length > (field.maxItems || 20)) return fail(field, 'has too many items.');
      var rows = [];
      for (var r = 0; r < v.length; r++) {
        if (!isObject(v[r])) return fail(field, 'has an invalid item.');
        var row = {};
        for (var s = 0; s < field.sub.length; s++) {
          var sub = field.sub[s];
          var cell = cleanText(sub, v[r][sub.key] === undefined ? '' : v[r][sub.key]);
          if (cell.error) return cell;
          row[sub.key] = cell.value;
        }
        rows.push(row);
      }
      return { value: rows };
    }

    if (type === 'coursePick') {
      if (!Array.isArray(v)) return fail(field, 'must be a list.');
      if (v.length > (field.maxItems || 3)) return fail(field, 'has too many items.');
      for (var c = 0; c < v.length; c++) {
        if (typeof v[c] !== 'string' || !ID.test(v[c]))
          return fail(field, 'has an invalid course.');
      }
      return { value: v.slice() };
    }

    return cleanText(field, v);
  }

  /** Text-like fields: text, textarea, select, url, video, image, file, date, datetime. */
  function cleanText(field, v) {
    if (typeof v !== 'string') return fail(field, 'must be text.');
    var type = field.type;
    var text = type === 'textarea' ? v.replace(CONTROL_KEEP_LINES, '') : v.replace(CONTROL, ' ');
    var max = field.max || (type === 'textarea' ? 1000 : 200);
    if (type === 'url' || type === 'video' || type === 'image' || type === 'file') max = 500;
    if (text.length > max) return fail(field, 'is too long (at most ' + max + ' characters).');
    if (field.required && text.replace(/^\s+|\s+$/g, '') === '') return fail(field, 'is required.');
    if (text === '') return { value: '' };

    if (type === 'select' && field.options.indexOf(text) < 0)
      return fail(field, 'has an option that is not allowed.');
    if ((type === 'url' || type === 'video') && !LINK.test(text.replace(/^\s+/, ''))) {
      return fail(field, 'must start with https:// (or / for a page on this site).');
    }
    if ((type === 'image' || type === 'file') && (!UPLOAD.test(text) || text.indexOf('..') >= 0)) {
      return fail(field, 'must be an uploaded file.');
    }
    if (type === 'file' && !/\.pdf$/i.test(text)) return fail(field, 'must be a PDF.');
    if (type === 'date' && !DATE.test(text)) return fail(field, 'is not a valid date.');
    if (type === 'datetime' && !DATETIME.test(text))
      return fail(field, 'is not a valid date and time.');
    if (field.pattern && !new RegExp(field.pattern, field.patternFlags || '').test(text)) {
      return { error: field.patternHelp || field.label + ' is not in the expected format.' };
    }
    return { value: text };
  }

  var out = {};

  // Declared content fields.
  var names = Object.keys(rule.fields);
  for (var n = 0; n < names.length; n++) {
    var key = names[n];
    var field = rule.fields[key];
    var has =
      Object.prototype.hasOwnProperty.call(data, key) &&
      data[key] !== undefined &&
      data[key] !== null;
    if (!has) {
      if (field.required) return { ok: false, error: field.label + ' is required.' };
      continue;
    }
    var cleaned = cleanValue(field, data[key]);
    if (cleaned.error) return { ok: false, error: cleaned.error };
    out[key] = cleaned.value;
  }

  // Bookkeeping keys the admin panel keeps on every item (order, published, sample marker).
  var system = rule.system || [];
  for (var k = 0; k < system.length; k++) {
    var sys = system[k];
    if (!Object.prototype.hasOwnProperty.call(data, sys)) continue;
    var value = data[sys];
    if (sys === 'order') {
      if (typeof value !== 'number' || !isFinite(value) || value < 0 || value > 100000) {
        return { ok: false, error: 'Order must be a number.' };
      }
    } else if (typeof value !== 'boolean') {
      return { ok: false, error: 'Invalid value for ' + sys + '.' };
    }
    out[sys] = value;
  }

  // Developer-only switches: never taken from the request.
  var locked = rule.developerOnly || {};
  var lockedKeys = Object.keys(locked);
  for (var d = 0; d < lockedKeys.length; d++) {
    var dk = lockedKeys[d];
    out[dk] =
      current && Object.prototype.hasOwnProperty.call(current, dk) ? current[dk] : locked[dk];
  }

  // Choices that can only be made when an item is created keep their stored value afterwards.
  if (current) {
    for (var n2 = 0; n2 < names.length; n2++) {
      var fk = names[n2];
      if (rule.fields[fk].addOnly && Object.prototype.hasOwnProperty.call(current, fk))
        out[fk] = current[fk];
    }
  }

  return { ok: true, data: out };
}
