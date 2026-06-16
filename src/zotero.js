// Mentegraf — Zotero Integration
// All API calls go through Electron main process (IPC)
// Zotero must be running with "Allow other apps" enabled

// ═══ API CALLS (via IPC) ═══

async function zoteroCheck() {
  if (!window.mentegraf || !window.mentegraf.zoteroCheck) {
    return false; // Not in Electron
  }
  try {
    return await window.mentegraf.zoteroCheck();
  } catch(e) {
    return false;
  }
}

async function zoteroGetCollections() {
  var data = await window.mentegraf.zoteroCollections();
  return data.map(function(c) {
    return {
      key: c.key,
      name: c.data.name,
      parentKey: c.data.parentCollection || null,
      itemCount: c.meta.numItems || 0
    };
  });
}

async function zoteroGetItems(collectionKey, limit) {
  var data = await window.mentegraf.zoteroItems(collectionKey || '', limit || 200);
  return data.map(function(item) {
    var d = item.data;
    var creators = (d.creators || []).map(function(c) {
      return ((c.firstName || '') + ' ' + (c.lastName || '')).trim();
    }).filter(Boolean);
    return {
      key: d.key,
      type: d.itemType,
      title: d.title || '(untitled)',
      creators: creators,
      date: d.date || '',
      abstractNote: d.abstractNote || '',
      tags: (d.tags || []).map(function(t) { return t.tag; }),
      publicationTitle: d.publicationTitle || '',
      url: d.url || '',
      DOI: d.DOI || ''
    };
  });
}

async function zoteroSearch(query) {
  var data = await window.mentegraf.zoteroSearch(query);
  return data.map(function(item) {
    var d = item.data;
    return {
      key: d.key,
      type: d.itemType,
      title: d.title || '(untitled)',
      creators: (d.creators || []).map(function(c) { return ((c.firstName||'')+' '+(c.lastName||'')).trim(); }).filter(Boolean),
      date: d.date || ''
    };
  });
}

// ═══ TYPE MAPPING ═══

var ZOTERO_TYPE_MAP = {
  'book':'book', 'bookSection':'book',
  'journalArticle':'document', 'conferencePaper':'document',
  'thesis':'document', 'report':'document', 'manuscript':'document',
  'magazineArticle':'document', 'newspaperArticle':'document',
  'webpage':'document', 'encyclopediaArticle':'document',
  'presentation':'document', 'film':'document',
  'interview':'event', 'letter':'document', 'patent':'document'
};

function zoteroTypeToMentegraf(zType) {
  return ZOTERO_TYPE_MAP[zType] || 'document';
}

// ═══ IMPORT TO MENTEGRAF ═══

function zoteroImportItems(items) {
  var imported = 0;
  var creatorNodes = {};

  items.forEach(function(item) {
    var nodeType = zoteroTypeToMentegraf(item.type);
    var cat = catById(nodeType);
    if (!cat) cat = categories[0];

    var ext = cy.extent();
    var x = (ext.x1 + ext.x2) / 2 + (Math.random() - 0.5) * 300;
    var y = (ext.y1 + ext.y2) / 2 + (Math.random() - 0.5) * 300;

    var nodeId = 'zn' + Date.now() + '_' + imported;
    cy.add({
      data: {
        id: nodeId, label: item.title, type: nodeType, color: cat.color,
        description: item.abstractNote ? item.abstractNote.substring(0, 200) : '',
        notes: [item.publicationTitle, item.date, item.DOI ? 'DOI: ' + item.DOI : '', item.url].filter(Boolean).join('\n'),
        tags: item.tags.length ? item.tags : [item.type],
        zoteroKey: item.key, x: x, y: y
      },
      position: { x: x, y: y }
    });
    imported++;

    // Create creator nodes and connect
    item.creators.forEach(function(creator) {
      if (!creator) return;
      if (!creatorNodes[creator]) {
        // Check existing
        var existing = null;
        cy.nodes().forEach(function(n) {
          if (n.data('label') === creator && n.data('type') === 'person') existing = n;
        });

        if (existing) {
          creatorNodes[creator] = existing.id();
        } else {
          var personCat = catById('person');
          var cid = 'zp' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
          var cx = x + (Math.random() - 0.5) * 150;
          var cy2 = y + (Math.random() - 0.5) * 150;
          cy.add({
            data: { id: cid, label: creator, type: 'person', color: personCat ? personCat.color : '#7b8cc4',
              description: '', notes: '', tags: [], x: cx, y: cy2 },
            position: { x: cx, y: cy2 }
          });
          creatorNodes[creator] = cid;
        }
      }
      cy.add({
        data: { id: 'ze' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
          source: creatorNodes[creator], target: nodeId, weight: 4, edgeType: 'influences', note: '' }
      });
    });
  });

  uStats();
  snapshot();
  return imported;
}

// ═══ OPEN IN ZOTERO ═══

function openInZotero(zoteroKey) {
  if (window.mentegraf && window.mentegraf.openExternal) {
    window.mentegraf.openExternal('zotero://select/items/' + zoteroKey);
  }
}

// ═══ UI ═══

async function openZoteroImport() {
  if (!window.mentegraf || !window.mentegraf.zoteroCheck) {
    alert(curLang === 'tr' ? 'Zotero entegrasyonu sadece masaüstü uygulamasında çalışır.' : 'Zotero integration requires the desktop app.');
    return;
  }

  var ok = await zoteroCheck();
  if (!ok) {
    alert(curLang === 'tr'
      ? 'Zotero\'ya bağlanılamadı.\n\n1. Zotero açık olmalı\n2. Tercihler → Gelişmiş → "Bu bilgisayardaki diğer uygulamaların Zotero ile iletişim kurmasına izin ver" işaretli olmalı'
      : 'Cannot connect to Zotero.\n\n1. Zotero must be running\n2. Preferences → Advanced → "Allow other applications on this computer to communicate with Zotero" must be checked');
    return;
  }

  var modal = document.getElementById('zoteroModal');
  modal.style.display = 'flex';

  var collDiv = document.getElementById('zotCollections');
  collDiv.innerHTML = '<div style="color:var(--dim);font-size:12px;padding:8px">' + (curLang === 'tr' ? 'Yükleniyor...' : 'Loading...') + '</div>';

  try {
    var collections = await zoteroGetCollections();
    collDiv.innerHTML = '';

    var allBtn = document.createElement('div');
    allBtn.className = 'zcoll selected';
    allBtn.textContent = curLang === 'tr' ? '📚 Tüm Öğeler' : '📚 All Items';
    allBtn.onclick = function() {
      collDiv.querySelectorAll('.zcoll').forEach(function(el) { el.classList.remove('selected'); });
      allBtn.classList.add('selected');
      loadZoteroItems('');
    };
    collDiv.appendChild(allBtn);

    collections.sort(function(a, b) { return a.name.localeCompare(b.name); });
    collections.forEach(function(c) {
      var div = document.createElement('div');
      div.className = 'zcoll';
      div.textContent = '📁 ' + c.name + ' (' + c.itemCount + ')';
      div.onclick = function() {
        collDiv.querySelectorAll('.zcoll').forEach(function(el) { el.classList.remove('selected'); });
        div.classList.add('selected');
        loadZoteroItems(c.key);
      };
      collDiv.appendChild(div);
    });

    loadZoteroItems('');
  } catch(e) {
    collDiv.innerHTML = '<div style="color:#c45a5a;font-size:12px;padding:8px">Error: ' + e.message + '</div>';
  }
}

async function loadZoteroItems(collectionKey) {
  var listDiv = document.getElementById('zotItems');
  listDiv.innerHTML = '<div style="color:var(--dim);font-size:12px;padding:8px">' + (curLang === 'tr' ? 'Yükleniyor...' : 'Loading...') + '</div>';

  try {
    var items = await zoteroGetItems(collectionKey, 200);
    listDiv.innerHTML = '';
    window._zoteroItems = {};

    items.forEach(function(item) {
      window._zoteroItems[item.key] = item;
      var div = document.createElement('div');
      div.className = 'zitem';
      div.innerHTML = '<label><input type="checkbox" value="' + item.key + '"> '
        + '<span class="zitem-title">' + item.title + '</span>'
        + '<span class="zitem-meta">' + item.creators.join(', ') + (item.date ? ' · ' + item.date : '') + '</span>'
        + '</label>';
      listDiv.appendChild(div);
    });

    document.getElementById('zotCount').textContent = items.length + (curLang === 'tr' ? ' öğe' : ' items');
  } catch(e) {
    listDiv.innerHTML = '<div style="color:#c45a5a;font-size:12px;padding:8px">Error: ' + e.message + '</div>';
  }
}

function zoteroSelectAll() {
  document.querySelectorAll('#zotItems input[type=checkbox]').forEach(function(cb) { cb.checked = true; });
}
function zoteroSelectNone() {
  document.querySelectorAll('#zotItems input[type=checkbox]').forEach(function(cb) { cb.checked = false; });
}

function zoteroDoImport() {
  var checked = document.querySelectorAll('#zotItems input[type=checkbox]:checked');
  var items = [];
  checked.forEach(function(cb) {
    if (window._zoteroItems[cb.value]) items.push(window._zoteroItems[cb.value]);
  });
  if (items.length === 0) return;
  var count = zoteroImportItems(items);
  closeZoteroImport();
  showMsg(count + (curLang === 'tr' ? ' öğe içe aktarıldı' : ' items imported'));
}

function closeZoteroImport() {
  document.getElementById('zoteroModal').style.display = 'none';
}

function zoteroSearchUI() {
  var q = document.getElementById('zotSearch').value.trim();
  if (q.length < 2) { loadZoteroItems(''); return; }

  var listDiv = document.getElementById('zotItems');
  listDiv.innerHTML = '<div style="color:var(--dim);font-size:12px;padding:8px">' + (curLang === 'tr' ? 'Aranıyor...' : 'Searching...') + '</div>';

  zoteroSearch(q).then(function(items) {
    listDiv.innerHTML = '';
    window._zoteroItems = {};
    items.forEach(function(item) {
      window._zoteroItems[item.key] = item;
      var div = document.createElement('div');
      div.className = 'zitem';
      div.innerHTML = '<label><input type="checkbox" value="' + item.key + '"> '
        + '<span class="zitem-title">' + item.title + '</span>'
        + '<span class="zitem-meta">' + item.creators.join(', ') + (item.date ? ' · ' + item.date : '') + '</span>'
        + '</label>';
      listDiv.appendChild(div);
    });
    document.getElementById('zotCount').textContent = items.length + (curLang === 'tr' ? ' sonuç' : ' results');
  });
}
