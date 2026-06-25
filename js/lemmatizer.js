// Rule-based English morphological analyzer
// Returns { base, type, description } or null if no derived form detected

const _IRREGULAR = {
  // Irregular verbs (past / past participle / 3rd-person singular)
  am:'be', is:'be', are:'be', was:'be', were:'be', been:'be',
  had:'have', has:'have',
  did:'do', done:'do', does:'do',
  went:'go', gone:'go', goes:'go',
  made:'make',
  took:'take', taken:'take',
  came:'come',
  saw:'see', seen:'see',
  knew:'know', known:'know',
  got:'get', gotten:'get',
  gave:'give', given:'give',
  found:'find',
  thought:'think',
  told:'tell',
  became:'become',
  shown:'show',
  left:'leave',
  felt:'feel',
  brought:'bring',
  began:'begin', begun:'begin',
  kept:'keep',
  held:'hold',
  wrote:'write', written:'write',
  stood:'stand',
  heard:'hear',
  meant:'mean',
  met:'meet',
  ran:'run',
  paid:'pay',
  sat:'sit',
  spoke:'speak', spoken:'speak',
  led:'lead',
  grew:'grow', grown:'grow',
  lost:'lose',
  fell:'fall', fallen:'fall',
  sent:'send',
  built:'build',
  spent:'spend',
  chose:'choose', chosen:'choose',
  drove:'drive', driven:'drive',
  broke:'break', broken:'break',
  rose:'rise', risen:'rise',
  wore:'wear', worn:'wear',
  threw:'throw', thrown:'throw',
  blew:'blow', blown:'blow',
  drew:'draw', drawn:'draw',
  flew:'fly', flown:'fly',
  bought:'buy',
  taught:'teach',
  caught:'catch',
  fought:'fight',
  sought:'seek',
  sold:'sell',
  shot:'shoot',
  forgot:'forget', forgotten:'forget',
  won:'win',
  hung:'hang',
  swam:'swim', swum:'swim',
  sang:'sing', sung:'sing',
  rang:'ring', rung:'ring',
  sank:'sink', sunk:'sink',
  drank:'drink', drunk:'drink',
  spun:'spin',
  dug:'dig',
  hid:'hide', hidden:'hide',
  rode:'ride', ridden:'ride',
  bit:'bite', bitten:'bite',
  ate:'eat', eaten:'eat',
  froze:'freeze', frozen:'freeze',
  stole:'steal', stolen:'steal',
  woke:'wake', woken:'wake',
  laid:'lay',
  lain:'lie',
  bore:'bear', borne:'bear',
  tore:'tear', torn:'tear',
  swore:'swear', sworn:'swear',
  proven:'prove',
  shone:'shine',
  shrank:'shrink', shrunk:'shrink',
  sprang:'spring', sprung:'spring',
  stung:'sting',
  stank:'stink', stunk:'stink',
  arose:'arise', arisen:'arise',
  forbade:'forbid', forbidden:'forbid',
  forgave:'forgive', forgiven:'forgive',
  undertook:'undertake', undertaken:'undertake',
  withdrew:'withdraw', withdrawn:'withdraw',
  overcame:'overcome',
  underwent:'undergo', undergone:'undergo',
  misled:'mislead',
  // Irregular plurals
  children:'child', men:'man', women:'woman',
  feet:'foot', teeth:'tooth', mice:'mouse',
  geese:'goose', oxen:'ox', people:'person',
  criteria:'criterion', phenomena:'phenomenon',
  alumni:'alumnus', syllabi:'syllabus',
  analyses:'analysis', bases:'basis',
  crises:'crisis', theses:'thesis',
  matrices:'matrix', vertices:'vertex',
  indices:'index', fungi:'fungus', cacti:'cactus',
  appendices:'appendix',
  // Irregular comparatives / superlatives
  better:'good', best:'good',
  worse:'bad', worst:'bad',
  farther:'far', farthest:'far',
  further:'far', furthest:'far',
  elder:'old', eldest:'old',
};

// Single consonants that can be doubled before suffix
const _DOUBLES = new Set('bcdfghjklmnpqrstvwxyz');
const _VOWELS  = new Set('aeiou');

function _isConsonant(ch) { return ch && _DOUBLES.has(ch) && !_VOWELS.has(ch); }

// Try to strip -ing and recover base form
function _stripIng(word) {
  if (!word.endsWith('ing') || word.length < 5) return null;
  const stem = word.slice(0, -3);

  // running → run (doubled consonant)
  if (stem.length >= 3) {
    const last = stem.slice(-1);
    const prev = stem.slice(-2, -1);
    if (last === prev && _isConsonant(last)) return stem.slice(0, -1);
  }
  // writing → write (e-drop: add e back)
  if (_isConsonant(stem.slice(-1)) && _VOWELS.has(stem.slice(-2, -1))) {
    // could be e-drop: "writ" → "write"
    const eForm = stem + 'e';
    if (eForm.length >= 4) return eForm;
  }
  // playing → play (simple removal)
  if (stem.length >= 3) return stem;
  return null;
}

// Try to strip -ed and recover base form
function _stripEd(word) {
  if (!word.endsWith('ed') || word.length < 5) return null;
  const stem = word.slice(0, -2);

  // stopped → stop (doubled consonant)
  if (stem.length >= 3) {
    const last = stem.slice(-1);
    const prev = stem.slice(-2, -1);
    if (last === prev && _isConsonant(last)) return stem.slice(0, -1);
  }
  // liked → like (e-drop)
  if (_isConsonant(stem.slice(-1)) && stem.length >= 3) {
    return stem + 'e'; // tried both with-e and without
  }
  // tried → try
  if (word.endsWith('ied')) return word.slice(0, -3) + 'y';
  // played → play
  return stem;
}

// Try to strip plural/3rd-person -s/-es
function _stripS(word) {
  if (word.length < 4) return null;
  // -ies → -y  (carries → carry)
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  // -oes → -o  (goes → go, heroes → hero)
  if (word.endsWith('oes')) return word.slice(0, -2);
  // -xes, -shes, -ches, -sses → remove -es
  if (word.endsWith('xes') || word.endsWith('ches') || word.endsWith('shes') || word.endsWith('sses'))
    return word.slice(0, -2);
  // -es  (boxes → box, wishes → wish)
  if (word.endsWith('es') && word.length > 4) return word.slice(0, -2);
  // plain -s
  if (word.endsWith('s') && word.length > 4) return word.slice(0, -1);
  return null;
}

// Try to strip comparative/superlative
function _stripDeg(word) {
  // biggest → big (double consonant)
  if (word.endsWith('est') || word.endsWith('er')) {
    const suffix = word.endsWith('est') ? 3 : 2;
    const stem = word.slice(0, -suffix);
    const last = stem.slice(-1);
    const prev = stem.slice(-2, -1);
    if (last === prev && _isConsonant(last)) return stem.slice(0, -1);
    // nicer → nice (e-drop)
    if (_isConsonant(stem.slice(-1)) && _VOWELS.has(stem.slice(-2, -1)) && stem.length >= 3)
      return stem + 'e';
    return stem;
  }
  return null;
}

function _typeLabel(type) {
  return { ing:'進行式／動名詞', ed:'過去式／分詞', plural:'複數', deg:'比較級／最高級', irreg:'不規則變化' }[type] || type;
}

/**
 * Detect if `input` is a derived English form.
 * Returns { base, type, description } or null.
 */
function detectBaseForm(input) {
  const word = (input || '').toLowerCase().trim();
  if (!word || word.length < 3) return null;

  // 1. Irregular lookup (highest priority)
  if (_IRREGULAR[word] && _IRREGULAR[word] !== word) {
    const base = _IRREGULAR[word];
    return { base, type: 'irreg', description: `不規則變化，原形為「${base}」` };
  }

  // 2. Rule-based (-ing)
  if (word.endsWith('ing')) {
    const base = _stripIng(word);
    if (base && base !== word && base.length >= 2)
      return { base, type: 'ing', description: `進行式／動名詞，原形可能為「${base}」` };
  }

  // 3. Rule-based (-ed)
  if (word.endsWith('ed')) {
    const base = _stripEd(word);
    if (base && base !== word && base.length >= 2)
      return { base, type: 'ed', description: `過去式／分詞，原形可能為「${base}」` };
  }

  // 4. Comparative / superlative
  if (word.endsWith('er') || word.endsWith('est')) {
    const base = _stripDeg(word);
    if (base && base !== word && base.length >= 3 && !_VOWELS.has(base.slice(-1)))
      return { base, type: 'deg', description: `比較級／最高級，原形可能為「${base}」` };
  }

  // 5. Plural / 3rd-person singular
  if (word.endsWith('s')) {
    const base = _stripS(word);
    if (base && base !== word && base.length >= 3)
      return { base, type: 'plural', description: `複數／第三人稱，原形可能為「${base}」` };
  }

  return null;
}
