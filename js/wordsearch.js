// Word Search Game Engine
// Adapted and extended from the reference implementation.
//
// Usage:
//   const ws = new WordSearchGame({ container, words, mode, occurrences, onComplete });
//   ws.render();
//   ws.destroy();
//
// mode: 'single'  — one word repeated `occurrences` (3-5) times; user finds all instances.
// mode: 'combined' — each word appears once; user finds all words.

class WordSearchGame {
  constructor({ container, words, labels, mode = 'combined', occurrences = 4, onComplete }) {
    this.container = container;
    this.rawWords = words.map(w => w.toUpperCase().replace(/[^A-Z]/g, '')).filter(w => w.length >= 2);
    this.labels = labels || {};   // { 'NEGOTIATE': '談判；協商' } — shown in word list
    this.mode = mode;
    this.targetOccurrences = occurrences; // for single mode
    this.onComplete = onComplete || (() => {});

    // Internal state
    this.gridSize = 0;
    this.gridData = [];
    this.placements = []; // { word, cells:[{r,c}], found:false }
    this.foundPaths = new Set();
    this.foundCount = 0; // combined: distinct words found; single: occurrences found

    this.isDragging = false;
    this.startCell = null;
    this.currentHighlight = [];

    this._bound = {};
  }

  // ── Grid generation ──────────────────────────────────────────────────────

  _calcSize() {
    if (this.mode === 'single') {
      const wLen = this.rawWords[0]?.length || 4;
      return Math.max(8, wLen + 2);
    }
    const maxLen = Math.max(...this.rawWords.map(w => w.length));
    const totalChars = this.rawWords.reduce((s, w) => s + w.length, 0);
    return Math.max(8, maxLen + 1, Math.ceil(Math.sqrt(totalChars * 2.8)));
  }

  _buildWords() {
    // For single mode: repeat the word `targetOccurrences` times
    if (this.mode === 'single') {
      const w = this.rawWords[0];
      return Array(this.targetOccurrences).fill(w);
    }
    return [...this.rawWords];
  }

  _buildGrid() {
    const DIRS = [
      [0,1],[0,-1],[1,0],[-1,0],
      [1,1],[1,-1],[-1,1],[-1,-1],
    ];
    const words = this._buildWords();
    const size = this.gridSize;

    for (let attempt = 0; attempt < 80; attempt++) {
      const grid = Array.from({ length: size }, () => Array(size).fill(''));
      const placements = [];
      let ok = true;

      const shuffled = [...words].sort(() => Math.random() - 0.5);

      for (const word of shuffled) {
        if (!this._placeWord(grid, word, size, DIRS, placements)) {
          ok = false;
          break;
        }
      }

      if (ok) {
        this._fillRandom(grid, size);
        this.gridData = grid;
        this.placements = placements;
        return true;
      }
    }
    return false;
  }

  _placeWord(grid, word, size, DIRS, placements) {
    const shuffledDirs = [...DIRS].sort(() => Math.random() - 0.5);
    for (let t = 0; t < 300; t++) {
      const dir = shuffledDirs[t % shuffledDirs.length];
      const r = Math.floor(Math.random() * size);
      const c = Math.floor(Math.random() * size);
      if (this._canPlace(grid, word, r, c, dir, size)) {
        const cells = this._doPlace(grid, word, r, c, dir);
        placements.push({ word, cells, found: false });
        return true;
      }
    }
    return false;
  }

  _canPlace(grid, word, r, c, [dr, dc], size) {
    for (let i = 0; i < word.length; i++) {
      const nr = r + dr * i, nc = c + dc * i;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size) return false;
      const ex = grid[nr][nc];
      if (ex !== '' && ex !== word[i]) return false;
    }
    return true;
  }

  _doPlace(grid, word, r, c, [dr, dc]) {
    const cells = [];
    for (let i = 0; i < word.length; i++) {
      const nr = r + dr * i, nc = c + dc * i;
      grid[nr][nc] = word[i];
      cells.push({ r: nr, c: nc });
    }
    return cells;
  }

  _fillRandom(grid, size) {
    const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (let r = 0; r < size; r++)
      for (let c = 0; c < size; c++)
        if (!grid[r][c])
          grid[r][c] = alpha[Math.floor(Math.random() * 26)];
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  render() {
    this.gridSize = this._calcSize();
    if (!this._buildGrid()) {
      this.container.innerHTML = '<p style="color:red;text-align:center">無法生成格子，請重試。</p>';
      return;
    }

    this.container.innerHTML = '';
    this.container.classList.add('ws-view');

    // Header
    const header = document.createElement('div');
    header.className = 'ws-header';
    if (this.mode === 'single') {
      const word = this.rawWords[0];
      const label = this.labels[word] || word;
      header.innerHTML = `<h2>找出：<span class="ws-word-label">${label}</span></h2>
        <p>在格子中找出所有 <strong>${this.targetOccurrences}</strong> 個隱藏的單字</p>`;
    } else {
      header.innerHTML = `<h2>綜合 Word Search</h2>
        <p>找出今天所有 ${this.rawWords.length} 個單字</p>`;
    }
    this.container.appendChild(header);

    // Counter
    this._counterEl = document.createElement('div');
    this._counterEl.className = 'ws-counter';
    this._updateCounter();
    this.container.appendChild(this._counterEl);

    // Grid
    const gridWrap = document.createElement('div');
    gridWrap.id = 'ws-grid-container';

    const grid = document.createElement('div');
    grid.id = 'ws-grid';

    // Responsive cell size (account for sidebar on desktop)
    const sideW  = window.innerWidth >= 768 ? 220 : 0;
    const availW = Math.min(window.innerWidth - sideW, 520) - 32;
    const cellSize = Math.max(24, Math.min(40, Math.floor(availW / this.gridSize)));
    const fontSize = Math.max(11, Math.floor(cellSize * 0.48));
    grid.style.gridTemplateColumns = `repeat(${this.gridSize}, ${cellSize}px)`;

    for (let r = 0; r < this.gridSize; r++) {
      for (let c = 0; c < this.gridSize; c++) {
        const cell = document.createElement('div');
        cell.className = 'ws-cell';
        cell.textContent = this.gridData[r][c];
        cell.dataset.r = r;
        cell.dataset.c = c;
        cell.style.width = cell.style.height = cellSize + 'px';
        cell.style.fontSize = fontSize + 'px';
        grid.appendChild(cell);
      }
    }
    gridWrap.appendChild(grid);
    this.container.appendChild(gridWrap);

    // Word list (combined mode only)
    if (this.mode === 'combined') {
      this._wordListEl = document.createElement('div');
      this._wordListEl.className = 'ws-found-list';
      this.rawWords.forEach(w => {
        const span = document.createElement('span');
        span.className = 'ws-found-item';
        span.textContent = this.labels[w] || w;   // show Chinese meaning if available
        span.id = `wfl-${w}`;
        this._wordListEl.appendChild(span);
      });
      this.container.appendChild(this._wordListEl);
    }

    this._attachEvents(grid);
  }

  _updateCounter() {
    if (!this._counterEl) return;
    if (this.mode === 'single') {
      this._counterEl.textContent = `找到 ${this.foundCount} / ${this.targetOccurrences} 次`;
    } else {
      const total = this.rawWords.length;
      const found = this.placements.filter(p => p.found).map(p => p.word);
      const unique = new Set(found).size;
      this._counterEl.textContent = `找到 ${unique} / ${total} 個`;
    }
  }

  // ── Drag / Touch events ──────────────────────────────────────────────────

  _attachEvents(grid) {
    const onStart = e => {
      const cell = (e.target || document.elementFromPoint(e.touches?.[0].clientX, e.touches?.[0].clientY))?.closest?.('.ws-cell');
      if (!cell) return;
      this.isDragging = true;
      this.startCell = { r: +cell.dataset.r, c: +cell.dataset.c };
      this._updateHighlight(this.startCell);
      e.preventDefault();
    };

    const onMove = e => {
      if (!this.isDragging) return;
      const pt = e.touches ? e.touches[0] : e;
      const el = document.elementFromPoint(pt.clientX, pt.clientY)?.closest?.('.ws-cell');
      if (el) this._updateHighlight({ r: +el.dataset.r, c: +el.dataset.c });
      e.preventDefault();
    };

    const onEnd = () => {
      if (!this.isDragging) return;
      this.isDragging = false;
      this._checkSelection();
      this._clearHighlight();
    };

    grid.addEventListener('mousedown', onStart);
    grid.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    grid.addEventListener('touchstart', onStart, { passive: false });
    grid.addEventListener('touchmove', onMove, { passive: false });
    grid.addEventListener('touchend', onEnd);

    this._bound = { grid, onEnd };
  }

  _getLineCells(start, end) {
    const dr = end.r - start.r, dc = end.c - start.c;
    if (dr === 0 && dc === 0) return [start];
    if (Math.abs(dr) !== 0 && Math.abs(dc) !== 0 && Math.abs(dr) !== Math.abs(dc)) return null;
    const stepR = dr === 0 ? 0 : Math.sign(dr);
    const stepC = dc === 0 ? 0 : Math.sign(dc);
    const len = Math.max(Math.abs(dr), Math.abs(dc));
    const cells = [];
    for (let i = 0; i <= len; i++)
      cells.push({ r: start.r + stepR * i, c: start.c + stepC * i });
    return cells;
  }

  _updateHighlight(end) {
    this._clearHighlight(false);
    const cells = this._getLineCells(this.startCell, end);
    if (!cells) return;
    this.currentHighlight = cells;
    cells.forEach(({ r, c }) => {
      const el = this._cellEl(r, c);
      if (el && !el.classList.contains('found')) el.classList.add('highlight');
    });
  }

  _clearHighlight(reset = true) {
    this.currentHighlight.forEach(({ r, c }) => {
      const el = this._cellEl(r, c);
      if (el && !el.classList.contains('found')) el.classList.remove('highlight');
    });
    if (reset) this.currentHighlight = [];
  }

  _checkSelection() {
    if (this.currentHighlight.length < 2) return;
    const cells = this.currentHighlight;
    const selected = cells.map(({ r, c }) => this.gridData[r][c]).join('');
    const reversed = selected.split('').reverse().join('');

    const pathKey = `${cells[0].r},${cells[0].c}-${cells[cells.length-1].r},${cells[cells.length-1].c}`;

    if (this.mode === 'single') {
      const word = this.rawWords[0];
      if ((selected === word || reversed === word) && !this.foundPaths.has(pathKey)) {
        this.foundPaths.add(pathKey);
        this.foundCount++;
        this._markFoundCells(cells);
        this._updateCounter();
        if (this.foundCount >= this.targetOccurrences) {
          setTimeout(() => this.onComplete({ found: this.foundCount }), 400);
        }
      }
    } else {
      // Combined mode: find unfound placement matching selection
      for (const placement of this.placements) {
        if (placement.found) continue;
        if ((selected === placement.word || reversed === placement.word) && !this.foundPaths.has(pathKey)) {
          placement.found = true;
          this.foundPaths.add(pathKey);
          this._markFoundCells(cells);
          this._markWordFound(placement.word);
          this._updateCounter();
          // Check if all distinct words found
          const foundWords = new Set(this.placements.filter(p => p.found).map(p => p.word));
          if (foundWords.size >= this.rawWords.length) {
            setTimeout(() => this.onComplete({ found: foundWords.size }), 400);
          }
          break;
        }
      }
    }
  }

  _markFoundCells(cells) {
    cells.forEach(({ r, c }) => {
      const el = this._cellEl(r, c);
      if (el) { el.classList.remove('highlight'); el.classList.add('found'); }
    });
  }

  _markWordFound(word) {
    const el = document.getElementById(`wfl-${word}`);
    if (el) el.classList.add('found');
  }

  _cellEl(r, c) {
    return document.querySelector(`#ws-grid .ws-cell[data-r="${r}"][data-c="${c}"]`);
  }

  destroy() {
    if (this._bound.onEnd) document.removeEventListener('mouseup', this._bound.onEnd);
    this.container.innerHTML = '';
  }
}
