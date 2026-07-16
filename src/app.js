// Mentegraf — Main Application
// Author's Book Planning Tool

var DEFAULT_CATEGORIES = [];
var DEFAULT_CONN_TYPES = [];

async function loadConfigs() {
  try {
    var catResp = await fetch('config/categories.json');
    DEFAULT_CATEGORIES = await catResp.json();
    var connResp = await fetch('config/connections.json');
    DEFAULT_CONN_TYPES = await connResp.json();
  } catch(e) {
    console.warn('Config files not found, using embedded defaults');
  }
}



var categories=[],connTypes=[];var nodeSizingOn=true;
function initConfig(){categories=JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));connTypes=JSON.parse(JSON.stringify(DEFAULT_CONN_TYPES))}
function catById(id){return categories.find(function(c){return c.id===id})}
function catLabel(c){return curLang==='en'?c.en:c.tr}
function connLabel(c){return curLang==='en'?c.en:c.tr}
function connById(id){return connTypes.find(function(c){return c.id===id})||connTypes[0]}
function catSVG(type){var c=catById(type);if(!c)c=categories[0];return 'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="'+c.svgPath+'" fill="white" opacity="0.9"/></svg>')}


var LANG_DATA = {};

async function loadLangs() {
  try {
    var trResp = await fetch('lang/tr.json');
    LANG_DATA.tr = await trResp.json();
    var enResp = await fetch('lang/en.json');
    LANG_DATA.en = await enResp.json();
  } catch(e) {
    console.warn('Lang files not found, using embedded defaults');
  }
}


var curLang='tr';
function L(k){var d=LANG_DATA[curLang]||LANG_DATA.tr||{};return d[k]||k}
function applyLang(){curLang=localStorage.getItem('mentegraf-lang')||'tr';if(window.mentegraf&&window.mentegraf.setLang)window.mentegraf.setLang(curLang);document.querySelectorAll('[data-l]').forEach(function(el){var v=L(el.dataset.l);if(v)el.textContent=v});document.querySelectorAll('[data-lp]').forEach(function(el){var v=L(el.dataset.lp);if(v)el.placeholder=v});rebuildETS()}
function toggleLang(){curLang=curLang==='tr'?'en':'tr';localStorage.setItem('mentegraf-lang',curLang);applyLang();buildTF();if(selEle&&selEle.isNode())selNode(selEle);if(window.mentegraf&&window.mentegraf.setLang)window.mentegraf.setLang(curLang)}
function rebuildETS(){var s=document.getElementById('eType');if(!s)return;var cv=s.value;s.innerHTML='';connTypes.forEach(function(ct){var o=document.createElement('option');o.value=ct.id;o.textContent=(ct.marker?ct.marker+' ':'')+connLabel(ct);o.style.color=ct.color||'';s.appendChild(o)});s.value=cv}

function openSettings(){document.getElementById('cfgSizing').checked = NodeSizing.getOptions(cy).enabled;document.getElementById('settingsModal').style.display='flex';renderCfgCats();renderCfgConns()}
function closeSettings(){document.getElementById('settingsModal').style.display='none'}
function renderCfgCats(){var c=document.getElementById('cfgCats');c.innerHTML='';categories.forEach(function(cat,i){var r=document.createElement('div');r.className='cfg-row';r.innerHTML='<input type="color" value="'+cat.color+'" onchange="categories['+i+'].color=this.value"><input type="text" value="'+cat.tr+'" placeholder="TR" style="width:70px" onchange="categories['+i+'].tr=this.value"><input type="text" value="'+cat.en+'" placeholder="EN" style="width:70px" onchange="categories['+i+'].en=this.value"><span style="font-size:10px;color:var(--dim);width:50px;overflow:hidden">'+cat.id+'</span><button class="cfg-del" onclick="if(categories.length>1){categories.splice('+i+',1);renderCfgCats()}">✕</button>';c.appendChild(r)});if(categories.length<10){var a=document.createElement('div');a.className='cfg-add';a.textContent='+ '+L('addCategory');a.onclick=function(){categories.push({id:'c'+Date.now(),tr:L('newItem'),en:'New',color:'#aaa',svgPath:'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z'});renderCfgCats()};c.appendChild(a)}}
function renderCfgConns(){var c=document.getElementById('cfgConns');c.innerHTML='';connTypes.forEach(function(ct,i){var r=document.createElement('div');r.className='cfg-row';if(i===0){r.innerHTML='<span style="font-size:11px;color:var(--dim);width:50px">default</span><input type="text" value="'+ct.tr+'" placeholder="TR" onchange="connTypes[0].tr=this.value"><input type="text" value="'+ct.en+'" placeholder="EN" onchange="connTypes[0].en=this.value">'}else{r.innerHTML='<input type="color" value="'+(ct.color||"#888")+'" style="width:28px;height:28px;border:0;padding:0;cursor:pointer;border-radius:4px" onchange="connTypes['+i+'].color=this.value"><input type="text" value="'+ct.tr+'" placeholder="TR" onchange="connTypes['+i+'].tr=this.value"><input type="text" value="'+ct.en+'" placeholder="EN" onchange="connTypes['+i+'].en=this.value"><input type="text" value="'+(ct.marker||"")+'" placeholder="marker" style="width:30px;text-align:center" onchange="connTypes['+i+'].marker=this.value" title="Marker symbol"><button class="cfg-del" onclick="if(connTypes.length>1){connTypes.splice('+i+',1);renderCfgConns()}">✕</button>'}c.appendChild(r)});if(connTypes.length<8){var a=document.createElement('div');a.className='cfg-add';a.textContent='+ '+L('addConnType');a.onclick=function(){connTypes.push({id:'r'+Date.now(),tr:L('newItem'),en:'New',color:'#888',marker:'',style:'solid'});renderCfgConns()};c.appendChild(a)}}
function saveSettings(){
  var sz=document.getElementById('cfgSizing').checked;
  sz?NodeSizing.enable(cy):NodeSizing.disable(cy);
  nodeSizingOn=sz;
  closeSettings();buildTF();rebuildETS();cy.style().update();showMsg(L('saved'));snapshot()}

var cy,selEle=null,nid=1,curTheme='dark',altHeld=false,dragCanvas,dragCtx,activeTypes;
var undoStack=[],redoStack=[],maxUndo=40,autoSaveTimer=null;
function snapshot(){var s=JSON.stringify(getProject());if(undoStack.length>0&&undoStack[undoStack.length-1]===s)return;undoStack.push(s);if(undoStack.length>maxUndo)undoStack.shift();redoStack=[];updateUB()}
function undo(){if(undoStack.length<2)return;redoStack.push(undoStack.pop());loadProject(JSON.parse(undoStack[undoStack.length-1]),true);updateUB()}
function redo(){if(!redoStack.length)return;var s=redoStack.pop();undoStack.push(s);loadProject(JSON.parse(s),true);updateUB()}
function updateUB(){document.getElementById('b_undo').classList.toggle('disabled',undoStack.length<2);document.getElementById('b_redo').classList.toggle('disabled',!redoStack.length)}
function startAutoSave(){if(autoSaveTimer)clearInterval(autoSaveTimer);autoSaveTimer=setInterval(function(){localStorage.setItem('mentegraf-project',JSON.stringify(getProject()));var ind=document.getElementById('autoSaveInd');ind.style.opacity='1';setTimeout(function(){ind.style.opacity='0'},1500)},30000)}

function init(){
  cy=cytoscape({container:document.getElementById('cy'),elements:[],
    style:[
      {selector:'node',style:{'label':'data(label)','width':36,'height':36,'background-color':'data(color)','background-image':function(e){return catSVG(e.data('type'))},'background-width':'55%','background-height':'55%','background-position-x':'50%','background-position-y':'45%','border-width':2,'border-color':'data(color)','border-opacity':.3,'font-size':11,'font-family':'"DM Sans",sans-serif','color':function(){return curTheme==='dark'?'#e0ddd4':'#2c2820'},'text-valign':'bottom','text-margin-y':7,'text-max-width':'110px','text-wrap':'wrap','min-zoomed-font-size':7,'opacity':1,'transition-property':'opacity,border-width,width,height','transition-duration':'.15s'}},
      {selector:'node:selected',style:{'border-width':3,'border-color':'#c5a05e','border-opacity':1,'width':42,'height':42}},
      {selector:'node.drag-target',style:{'border-width':3,'border-color':'#5da89a','border-opacity':1,'width':44,'height':44}},
      {selector:'node.search-hit',style:{'border-width':3,'border-color':'#c5a05e','border-opacity':1}},
      {selector:'node.filtered-out',style:{'display':'none'}},
      {selector:'edge',style:{
'width':function(e){return Math.max(1,(e.data('weight')||1)*1.5)},
'line-color':function(e){var ct=connById(e.data('edgeType')||'');return ct.color||'#888'},
'line-opacity':.7,
'curve-style':'bezier',
'line-style':function(e){var ct=connById(e.data('edgeType')||'');return ct.style||'solid'},
'label':function(e){var ct=connById(e.data('edgeType')||'');return ct.marker||''},
'font-size':14,
'font-weight':'bold',
'text-rotation':'autorotate',
'text-margin-y':0,
'text-background-color':function(){return curTheme==='dark'?'#0f0f16':'#f5f2ec'},
'text-background-opacity':0.85,
'text-background-padding':'3px',
'text-background-shape':'roundrectangle',
'text-border-width':0,
'color':function(e){var ct=connById(e.data('edgeType')||'');return ct.color||'#888'},
'min-zoomed-font-size':6,
'opacity':.6
}},
      {selector:'edge:selected',style:{'line-color':'#c5a05e','opacity':1,'width':4,'line-opacity':1,'font-size':13,'text-outline-width':4}},
      {selector:'edge.filtered-out',style:{'display':'none'}},
      {selector:'.hl',style:{'opacity':1}},
      {selector:'.hle',style:{'opacity':1,'line-color':function(e){var ct=connById(e.data('edgeType')||'');return ct.color||'#c5a05e'},'line-opacity':.85,'z-index':10,'width':function(e){return Math.max(2,(e.data('weight')||1)*2.5)},'font-size':16,'text-background-opacity':.9}},
      {selector:'.dim',style:{'opacity':.18}},
      {selector: 'node[_wsize]', style: {'width':  'data(_wsize)', 'height': 'data(_wsize)'}},
      {selector:'node[_wsize]:selected',style:{'width':function(n){return n.data('_wsize')+6},'height':function(n){return n.data('_wsize')+6}}},
      {selector:'node[_wsize].drag-target',style:{'width':function(n){return n.data('_wsize')+8},'height':function(n){return n.data('_wsize')+8}}}
    ],layout:{name:'preset'},minZoom:.1,maxZoom:5,wheelSensitivity:.3});
  NodeSizing.bind(cy,{minSize:28,maxSize:72,defaultWeight:3,enabled:true});
  cy.on('tap','node',function(e){if(altHeld&&selEle&&selEle.isNode()&&selEle.id()!==e.target.id()){createEB(selEle,e.target);snapshot()}else if(e.originalEvent.ctrlKey||e.originalEvent.metaKey){toggleMultiSel(e.target)}else{multiClear();selNode(e.target)}});
  cy.on('tap','edge',function(e){selEdge(e.target)});
  cy.on('tap',function(e){if(e.target===cy)clrSel()});
  cy.on('mouseover','node',function(e){if(!selEle&&!altHeld)hlN(e.target);if(altHeld&&selEle&&selEle.isNode()&&selEle.id()!==e.target.id())e.target.addClass('drag-target')});
  cy.on('mouseout','node',function(e){if(!selEle&&!altHeld)clrHL();e.target.removeClass('drag-target')});
  cy.on('free','node',function(e){posAB();e.target.data('x',e.target.position('x'));e.target.data('y',e.target.position('y'));snapshot()});
  cy.on('pan zoom',function(){posAB()});
  dragCanvas=document.getElementById('dragCanvas');dragCtx=dragCanvas.getContext('2d');resizeCanvas();window.addEventListener('resize',resizeCanvas);
  buildTF();uStats();
}
function resizeCanvas(){var r=document.getElementById('cy').getBoundingClientRect();dragCanvas.width=r.width;dragCanvas.height=r.height}
function buildTF(){var c=document.getElementById('typeFilters');c.innerHTML='';activeTypes=new Set(categories.map(function(c){return c.id}));categories.forEach(function(cat){var b=document.createElement('button');b.className='tf on';b.innerHTML='<span class="tdd" style="background:'+cat.color+'"></span>'+catLabel(cat);b.onclick=function(){if(activeTypes.has(cat.id)){if(activeTypes.size>1){activeTypes.delete(cat.id);b.classList.remove('on')}}else{activeTypes.add(cat.id);b.classList.add('on')}applyTF()};c.appendChild(b)})}
function applyTF(){cy.batch(function(){cy.nodes().forEach(function(n){n[activeTypes.has(n.data('type'))?'removeClass':'addClass']('filtered-out')});cy.edges().forEach(function(e){e[(e.source().hasClass('filtered-out')||e.target().hasClass('filtered-out'))?'addClass':'removeClass']('filtered-out')})});uStats()}
function doSearch(q){cy.nodes().removeClass('search-hit');q=q.toLowerCase().trim();if(q.length<2){cy.nodes().forEach(function(n){n.style('opacity',1)});return}var hits=[];cy.nodes().forEach(function(n){if(n.hasClass('filtered-out'))return;if(n.data('label').toLowerCase().indexOf(q)>=0){n.addClass('search-hit');hits.push(n);n.style('opacity',1)}else n.style('opacity',.18)});if(hits.length===1)cy.animate({center:{eles:hits[0]},zoom:1.5,duration:400});else if(hits.length>1)cy.animate({fit:{eles:cy.nodes('.search-hit'),padding:80},duration:400})}

document.addEventListener('keydown',function(e){if(e.key==='Alt'){e.preventDefault();if(selEle&&selEle.isNode()){altHeld=true;document.getElementById('altHint').style.display='block';document.getElementById('cy').style.cursor='crosshair';clrHL()}}if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.tagName==='SELECT')return;if(e.ctrlKey&&e.key==='d'){e.preventDefault();addNodeFree()}if(e.ctrlKey&&e.key==='s'){e.preventDefault();doSave()}if(e.ctrlKey&&e.key==='z'){e.preventDefault();if(e.shiftKey)redo();else undo()}if(e.key==='Delete')delSel();if(e.key==='Escape'){clrSel();document.getElementById('searchBox').value='';doSearch('');closeSettings();closeExport();if(typeof closeZoteroImport==='function')closeZoteroImport();if(typeof closeReport==='function')closeReport()}});
document.addEventListener('keyup',function(e){if(e.key==='Alt'){altHeld=false;document.getElementById('altHint').style.display='none';document.getElementById('cy').style.cursor='default';cy.nodes().removeClass('drag-target');clearDL()}});
document.getElementById('cy').addEventListener('mousemove',function(e){if(!altHeld||!selEle||!selEle.isNode()){clearDL();return}var r=document.getElementById('cy').getBoundingClientRect(),fp=selEle.renderedPosition();clearDL();dragCtx.beginPath();dragCtx.setLineDash([6,4]);dragCtx.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue('--drag-line').trim();dragCtx.lineWidth=2;dragCtx.moveTo(fp.x,fp.y);dragCtx.lineTo(e.clientX-r.left,e.clientY-r.top);dragCtx.stroke()});
function clearDL(){if(dragCtx)dragCtx.clearRect(0,0,dragCanvas.width,dragCanvas.height)}
function createEB(a,b){if(cy.edges().some(function(e){return(e.source().id()===a.id()&&e.target().id()===b.id())||(e.source().id()===b.id()&&e.target().id()===a.id())}))return;var edge=cy.add({data:{id:'e'+Date.now(),source:a.id(),target:b.id(),weight:3,edgeType:'',note:''}});clearDL();cy.nodes().removeClass('drag-target');selEdge(edge);uStats()}

function posAB(){var btn=document.getElementById('addBtn');if(!selEle||!selEle.isNode()){btn.style.display='none';return}var pos=selEle.renderedPosition(),cyR=document.getElementById('cy').getBoundingClientRect();btn.style.left=(pos.x+24)+'px';btn.style.top=(pos.y-14)+'px';btn.style.display='block'}
function addNodeFree(){var ext=cy.extent(),x=(ext.x1+ext.x2)/2+(Math.random()-.5)*150,y=(ext.y1+ext.y2)/2+(Math.random()-.5)*150;selNode(mkNode(x,y));document.getElementById('nName').focus();document.getElementById('nName').select();snapshot()}
function addNodeConnected(){if(!selEle||!selEle.isNode())return;var pp=selEle.position(),a=Math.random()*Math.PI*2,n=mkNode(pp.x+Math.cos(a)*120,pp.y+Math.sin(a)*120);cy.add({data:{id:'e'+Date.now(),source:selEle.id(),target:n.id(),weight:3,edgeType:'',note:''}});selNode(n);document.getElementById('nName').focus();document.getElementById('nName').select();uStats();snapshot()}
function mkNode(x,y){var id='n'+(nid++);var dc=categories[0]||{id:'concept',color:'#5da89a'};cy.add({data:{id:id,label:L('addNode'),type:dc.id,color:dc.color,description:'',notes:'',tags:[],x:x,y:y},position:{x:x,y:y}});uStats();return cy.getElementById(id)}
function liveUpdateName(){if(selEle&&selEle.isNode())selEle.data('label',document.getElementById('nName').value||L('addNode'))}

/* ═══ PANEL SLIDE ═══ */
function openPanel(){document.getElementById('panel').classList.add('open')}
function closePanel(){document.getElementById('panel').classList.remove('open');selEle=null;cy.elements().deselect();document.getElementById('addBtn').style.display='none';clrHL()}

function selNode(n){clrSel();selEle=n;cy.elements().deselect();n.select();posAB();
  document.getElementById('nodeEd').style.display='block';document.getElementById('edgeEd').style.display='none';
  document.getElementById('panTitle').textContent=L('nodeDetail');openPanel();
  var d=n.data();document.getElementById('nName').value=d.label||'';document.getElementById('nDesc').value=d.description||'';document.getElementById('nNotes').value=d.notes||'';document.getElementById('nTags').value=(d.tags||[]).join(', ');
  var wd=n.data('_wdeg');document.getElementById('nWdeg').textContent=(nodeSizingOn&&wd!==undefined)?L('wdeg')+': '+wd:'';
  var g=document.getElementById('tGrid');g.innerHTML='';
  categories.forEach(function(cat){var b=document.createElement('button');b.className=d.type===cat.id?'sel':'';b.innerHTML='<svg viewBox="0 0 24 24"><path d="'+cat.svgPath+'"/></svg><span class="tn">'+catLabel(cat)+'</span>';b.onclick=function(){g.querySelectorAll('button').forEach(function(x){x.classList.remove('sel')});b.classList.add('sel');n.data('type',cat.id);n.data('color',cat.color);snapshot()};g.appendChild(b)});
  // Zotero link
var zk=n.data('zoteroKey');
var connSection=document.querySelector('.cs');
var existingZot=document.getElementById('zotLink');
if(existingZot)existingZot.remove();
if(zk){
  var zl=document.createElement('div');zl.id='zotLink';zl.style.cssText='margin-bottom:12px';
  zl.innerHTML='<button class="bt bg" onclick="openInZotero(\''+zk+'\')" style="font-size:11px;padding:5px 12px;width:100%"><svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:currentColor;vertical-align:middle;margin-right:4px"><path d="M1.5 2v4.5h3L1.5 10h6V6.5h-3L7.5 3V2h-6zM9 4v2h12V4H9zm0 6v2h12v-2H9z"/></svg> Zotero\'da Aç</button>';
  connSection.insertBefore(zl,connSection.firstChild);
}
var cl=document.getElementById('connList');cl.innerHTML='';
  n.connectedEdges().forEach(function(e){var o=e.source().id()===n.id()?e.target():e.source();var oc=catById(o.data('type'));var col=oc?oc.color:'#666';var div=document.createElement('div');div.className='ci';var w=e.data('weight')||0,ws='';for(var i=0;i<5;i++)ws+=i<w?'●':'○';var ect=connById(e.data('edgeType')||'');div.innerHTML='<span><span class="cdo" style="background:'+col+'"></span>'+o.data('label')+(ect.marker?' <span style="color:'+ect.color+';font-size:10px">'+ect.marker+'</span>':'')+'</span><span style="font-size:10px;color:var(--dim);letter-spacing:1px">'+ws+'</span>';div.onclick=function(){selNode(o);cy.animate({center:{eles:o},duration:300})};cl.appendChild(div)})}
function saveNode(){if(!selEle||!selEle.isNode())return;var name=document.getElementById('nName').value.trim();if(!name)return;selEle.data('label',name);selEle.data('description',document.getElementById('nDesc').value);selEle.data('notes',document.getElementById('nNotes').value);selEle.data('tags',document.getElementById('nTags').value.split(',').map(function(s){return s.trim()}).filter(Boolean));uStats();showMsg(L('saved'));snapshot()}

function selEdge(e){clrSel();selEle=e;cy.elements().deselect();e.select();document.getElementById('addBtn').style.display='none';
  document.getElementById('nodeEd').style.display='none';document.getElementById('edgeEd').style.display='block';
  document.getElementById('panTitle').textContent=L('edgeDetail');openPanel();
  document.getElementById('eInfo').textContent=e.source().data('label')+' ↔ '+e.target().data('label');rebuildETS();document.getElementById('eType').value=e.data('edgeType')||'';document.getElementById('eNote').value=e.data('note')||'';
  var wd=document.getElementById('wDots');wd.innerHTML='';var cw=e.data('weight')||3;
  for(var i=1;i<=5;i++){(function(v){var d=document.createElement('button');d.className='wdt'+(v<=cw?' on':'');d.textContent=v;d.onclick=function(){e.data('weight',v);wd.querySelectorAll('.wdt').forEach(function(x,idx){x.classList.toggle('on',idx<v)});snapshot()};wd.appendChild(d)})(i)}}
function saveEdge(){if(!selEle||!selEle.isEdge())return;selEle.data('edgeType',document.getElementById('eType').value);selEle.data('note',document.getElementById('eNote').value);showMsg(L('saved'));snapshot()}

function clrSel(){selEle=null;clrHL();cy.elements().deselect();document.getElementById('addBtn').style.display='none';document.getElementById('altHint').style.display='none';document.getElementById('panel').classList.remove('open');document.getElementById('nodeEd').style.display='none';document.getElementById('edgeEd').style.display='none';clearDL()}
function delSel(){if(!selEle)return;snapshot();cy.remove(selEle);clrSel();uStats();snapshot()}
function hlN(n){cy.batch(function(){cy.elements().addClass('dim');n.removeClass('dim').addClass('hl');var nb=n.neighborhood();nb.nodes().filter(function(x){return!x.hasClass('filtered-out')}).removeClass('dim').addClass('hl');nb.edges().filter(function(x){return!x.hasClass('filtered-out')}).removeClass('dim').addClass('hle')})}
function clrHL(){cy.batch(function(){cy.elements().removeClass('dim hl hle')})}
function doLayout(){cy.layout({name:'cose',animate:true,animationDuration:800,randomize:false,nodeDimensionsIncludeLabels:true,idealEdgeLength:function(){return 130},nodeRepulsion:function(){return 8000},gravity:.35,numIter:2000,padding:50}).run()}
function toggleTheme(){curTheme=curTheme==='dark'?'light':'dark';document.documentElement.setAttribute('data-theme',curTheme);localStorage.setItem('mentegraf-theme',curTheme);cy.style().update()}

function getProject(){var nodes=[],edges=[];cy.nodes().forEach(function(n){var d=n.data(),p=n.position();nodes.push({data:{id:d.id,label:d.label,type:d.type,color:d.color,description:d.description||'',notes:d.notes||'',tags:d.tags||[],x:p.x,y:p.y},position:p})});cy.edges().forEach(function(e){var d=e.data();edges.push({data:{id:d.id,source:d.source,target:d.target,weight:d.weight||3,edgeType:d.edgeType||'',note:d.note||''}})});return{version:'2.0',app:'Mentegraf',lang:curLang,config:{categories:categories,connectionTypes:connTypes,nodeSizing:nodeSizingOn},elements:{nodes:nodes,edges:edges}}}
function loadProject(data,noSnap){if(data.config){if(data.config.categories&&data.config.categories.length)categories=data.config.categories;if(data.config.connectionTypes&&data.config.connectionTypes.length){
  connTypes=data.config.connectionTypes;
  var defMap={};DEFAULT_CONN_TYPES.forEach(function(d){defMap[d.id]=d});
  connTypes.forEach(function(ct){var df=defMap[ct.id];if(df){if(!ct.color)ct.color=df.color;if(!ct.marker)ct.marker=df.marker;if(!ct.style)ct.style=df.style}else{if(!ct.color)ct.color='#888';if(!ct.marker)ct.marker='';if(!ct.style)ct.style='solid'}})
}
  nodeSizingOn=data.config.nodeSizing!==false;                    // ← NEW
  nodeSizingOn?NodeSizing.enable(cy):NodeSizing.disable(cy);      // ← NEW
}if(data.elements&&data.elements.nodes)data.elements.nodes.forEach(function(n){var c=catById(n.data.type);if(c)n.data.color=c.color});cy.elements().remove();cy.add([].concat(data.elements.nodes||[]).concat(data.elements.edges||[]));if(data.elements.nodes)data.elements.nodes.forEach(function(n){if(n.data.x!==undefined)cy.getElementById(n.data.id).position({x:n.data.x,y:n.data.y})});cy.fit(null,50);nid=1;cy.nodes().forEach(function(n){var id=parseInt(n.id().replace('n',''));if(!isNaN(id)&&id>=nid)nid=id+1});buildTF();rebuildETS();uStats();clrSel();if(!noSnap)snapshot()}
async function doSave(){var data=getProject();if(window.mentegraf){var ok=await window.mentegraf.saveData(data);if(ok)showMsg(L('saved'))}else{localStorage.setItem('mentegraf-project',JSON.stringify(data));showMsg(L('saved'))}}

function doImport(ev){var f=ev.target.files[0];if(!f)return;var r=new FileReader();r.onload=function(e){try{var d=JSON.parse(e.target.result);if(d.elements){loadProject(d);showMsg(f.name+' '+L('loaded'))}}catch(err){alert('Error: '+err.message)}};r.readAsText(f);ev.target.value=''}
function doLoad(){if(window.mentegraf)return;var raw=localStorage.getItem('mentegraf-project');if(raw){try{loadProject(JSON.parse(raw))}catch(e){}}}


/* ═══ MULTI-SELECT ═══ */
var multiSel=new Set();
function toggleMultiSel(n){
  if(multiSel.has(n.id())){multiSel.delete(n.id());n.removeClass('multi-sel')}
  else{multiSel.add(n.id());n.addClass('multi-sel')}
  var bar=document.getElementById('multiBar');
  if(multiSel.size>1){bar.classList.add('show');document.getElementById('multiCount').textContent=multiSel.size+' '+L('selected')}
  else{bar.classList.remove('show')}
}
function multiDelete(){multiSel.forEach(function(id){cy.getElementById(id).remove()});multiSel.clear();document.getElementById('multiBar').classList.remove('show');clrSel();uStats();snapshot()}
function multiClear(){multiSel.forEach(function(id){cy.getElementById(id).removeClass('multi-sel')});multiSel.clear();document.getElementById('multiBar').classList.remove('show')}

/* ═══ EXPORT MODAL ═══ */
function openExport(){document.getElementById('exportModal').style.display='flex'}
function closeExport(){document.getElementById('exportModal').style.display='none'}

/* ═══ CATEGORY REPORT EXPORT ═══ */
function doExportCategoryReport(){
  closeExport();
  var container=document.getElementById('reportCats');
  container.innerHTML='';
  categories.forEach(function(cat){
    var label=document.createElement('label');
    label.style.cssText='display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:6px;border:1px solid var(--border);cursor:pointer;margin-bottom:4px;background:var(--badge-bg);margin-left:4px;width:48%;float:left';
    label.innerHTML='<input type="checkbox" value="'+cat.id+'" checked style="accent-color:var(--accent)"><span style="width:10px;height:10px;border-radius:50%;background:'+cat.color+';flex-shrink:0"></span><span style="font-size:13px">'+catLabel(cat)+'</span>';
    container.appendChild(label);
  });
  document.getElementById('reportModal').style.display='flex';
}
function closeReport(){document.getElementById('reportModal').style.display='none'}

function generateReport(format){
  var checked=document.getElementById('reportCats').querySelectorAll('input[type=checkbox]:checked');
  var selectedTypes=new Set();
  checked.forEach(function(cb){selectedTypes.add(cb.value)});
  var includeConns=document.getElementById('reportIncludeConns').checked;
  closeReport();

  // Gather nodes by category
  var grouped={};
  categories.forEach(function(cat){
    if(!selectedTypes.has(cat.id))return;
    grouped[cat.id]={cat:cat,nodes:[]};
  });

  cy.nodes().forEach(function(n){
    var d=n.data();
    if(!grouped[d.type])return;
    var conns=[];
    if(includeConns){
      n.connectedEdges().forEach(function(e){
        var o=e.source().id()===n.id()?e.target():e.source();
        var ct=connById(e.data('edgeType')||'');
        conns.push({label:o.data('label'),type:o.data('type'),edgeType:ct?connLabel(ct):'',marker:ct?ct.marker:'',weight:e.data('weight')||0});
      });
      conns.sort(function(a,b){return b.weight-a.weight});
    }
    grouped[d.type].nodes.push({label:d.label,description:d.description||'',notes:d.notes||'',tags:d.tags||[],connections:conns});
  });

  // Sort nodes alphabetically within each category
  Object.values(grouped).forEach(function(g){
    g.nodes.sort(function(a,b){return a.label.localeCompare(b.label,curLang)});
  });

  if(format==='md') generateReportMD(grouped);
  else if(format==='csv') generateReportCSV(grouped);
  else generateReportHTML(grouped);
}

function generateReportMD(grouped){
  var md='# '+L('reportHeader')+'\n\n';
  md+='*'+(new Date().toLocaleDateString(curLang==='tr'?'tr-TR':'en-US',{year:'numeric',month:'long',day:'numeric'}))+'*\n\n';

  Object.values(grouped).forEach(function(g){
    if(g.nodes.length===0)return;
    md+='## '+catLabel(g.cat)+' ('+g.nodes.length+')\n\n';

    g.nodes.forEach(function(n){
      md+='### '+n.label+'\n\n';
      if(n.description) md+=n.description+'\n\n';
      if(n.notes) md+='> '+n.notes.replace(/\n/g,'\n> ')+'\n\n';
      if(n.tags.length) md+='**'+L('tagsLabel2')+':** '+n.tags.join(', ')+'\n\n';
      if(n.connections.length){
        md+='**'+L('connections')+':**\n\n';
        n.connections.forEach(function(c){
          md+='- '+c.label;
          if(c.marker) md+=' '+c.marker;
          if(c.edgeType) md+=' ('+c.edgeType+')';
          md+='\n';
        });
        md+='\n';
      }
      md+='---\n\n';
    });
  });

  var blob=new Blob([md],{type:'text/markdown'});
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a');a.href=url;a.download='mentegraf-report.md';
  document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
  showMsgL('reportGenerated');
}

function generateReportHTML(grouped){
  var h='<!DOCTYPE html><html lang="'+curLang+'"><head><meta charset="UTF-8"><title>'+L('reportHeader')+'</title>';
  h+='<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Georgia,serif;max-width:800px;margin:40px auto;padding:0 24px;color:#2c2820;line-height:1.7}';
  h+='h1{font-size:28px;margin-bottom:4px}h2{font-size:20px;margin:32px 0 16px;padding-bottom:8px;border-bottom:2px solid #e0ddd4}';
  h+='h3{font-size:16px;margin:20px 0 6px}.meta{font-size:13px;color:#888;margin-bottom:24px}';
  h+='.desc{font-size:15px;margin-bottom:8px}.notes{font-size:13px;color:#666;background:#f8f6f2;padding:10px 14px;border-radius:6px;margin-bottom:8px;border-left:3px solid #e0ddd4}';
  h+='.tags{font-size:12px;color:#999;margin-bottom:8px}.tags span{background:#f0ede6;padding:1px 8px;border-radius:10px;margin-right:4px}';
  h+='.conns{font-size:13px;margin-bottom:8px}.conns li{margin-bottom:2px;color:#555}';
  h+='.marker{font-weight:bold;margin:0 2px}.etype{color:#999;font-size:11px}';
  h+='hr{border:none;border-top:1px solid #eae7e0;margin:16px 0}.cat-dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:middle}';
  h+='@media print{body{margin:20px}h2{break-before:page}}</style></head><body>';
  h+='<h1>'+L('reportHeader')+'</h1>';
  h+='<div class="meta">'+(new Date().toLocaleDateString(curLang==='tr'?'tr-TR':'en-US',{year:'numeric',month:'long',day:'numeric'}))+'</div>';

  Object.values(grouped).forEach(function(g){
    if(g.nodes.length===0)return;
    h+='<h2><span class="cat-dot" style="background:'+g.cat.color+'"></span>'+catLabel(g.cat)+' ('+g.nodes.length+')</h2>';

    g.nodes.forEach(function(n){
      h+='<h3>'+n.label+'</h3>';
      if(n.description) h+='<div class="desc">'+n.description+'</div>';
      if(n.notes) h+='<div class="notes">'+n.notes.replace(/\n/g,'<br>')+'</div>';
      if(n.tags.length) h+='<div class="tags">'+L('tagsLabel2')+': '+n.tags.map(function(t){return '<span>'+t+'</span>'}).join('')+'</div>';
      if(n.connections.length){
        h+='<ul class="conns">';
        n.connections.forEach(function(c){
          h+='<li>'+c.label;
          if(c.marker) h+=' <span class="marker" style="color:'+((connTypes.find(function(ct){return connLabel(ct)===c.edgeType})||{}).color||'#888')+'">'+c.marker+'</span>';
          if(c.edgeType) h+=' <span class="etype">'+c.edgeType+'</span>';
          h+='</li>';
        });
        h+='</ul>';
      }
      h+='<hr>';
    });
  });

  h+='</body></html>';
  var blob=new Blob([h],{type:'text/html'});
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a');a.href=url;a.download='mentegraf-report.html';
  document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
  showMsgL('reportGenerated');
}


function generateReportCSV(grouped){
  // Nodes sheet
  var nRows=[['id','label','type','description','notes','tags','zoteroKey'].join('\t')];
  Object.values(grouped).forEach(function(g){
    g.nodes.forEach(function(n){
      var node=cy.nodes().filter(function(nd){return nd.data('label')===n.label&&nd.data('type')===g.cat.id}).first();
      nRows.push([
        node?node.id():'',
        csvEsc(n.label),
        catLabel(g.cat),
        csvEsc(n.description),
        csvEsc(n.notes),
        csvEsc(n.tags.join('; ')),
        node?node.data('zoteroKey')||'':''
      ].join('\t'));
    });
  });

  // Edges sheet
  var eRows=[['source','target','type','marker','weight','note'].join('\t')];
  var selectedTypes=new Set();
  Object.keys(grouped).forEach(function(k){selectedTypes.add(k)});

  cy.edges().forEach(function(e){
    var sType=e.source().data('type'), tType=e.target().data('type');
    if(!selectedTypes.has(sType)&&!selectedTypes.has(tType))return;
    var ct=connById(e.data('edgeType')||'');
    eRows.push([
      csvEsc(e.source().data('label')),
      csvEsc(e.target().data('label')),
      ct?connLabel(ct):'',
      ct?ct.marker||'':'',
      e.data('weight')||'',
      csvEsc(e.data('note')||'')
    ].join('\t'));
  });

  var tsv=nRows.join('\n')+'\n\n---EDGES---\n\n'+eRows.join('\n');
  var blob=new Blob([tsv],{type:'text/tab-separated-values;charset=utf-8'});
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a');a.href=url;a.download='mentegraf-report.tsv';
  document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
  showMsg(L('reportGenerated'));
}

function csvEsc(s){if(!s)return '';s=String(s).replace(/\t/g,' ').replace(/\n/g,' | ');return s}

function doExportJSON(){var data=getProject(),blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='mentegraf-export.json';document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);closeExport();showMsg(L('exported'))}

/* ═══ OBSIDIAN EXPORT ═══ */
function doExportObsidian(){
  var proj=getProject();var files=[];
  var nodeMap={};proj.elements.nodes.forEach(function(n){nodeMap[n.data.id]=n.data});
  proj.elements.nodes.forEach(function(n){
    var d=n.data;var cat=catById(d.type);
    var md='---\n';
    md+='type: '+(cat?catLabel(cat):d.type)+'\n';
    if(d.tags&&d.tags.length)md+='tags: ['+d.tags.join(', ')+']\n';
    md+='---\n\n';
    if(d.description)md+=d.description+'\n\n';
    if(d.notes)md+='## Notes\n\n'+d.notes+'\n\n';
    // Find connections
    var conns=[];
    proj.elements.edges.forEach(function(e){
      var eid=e.data;
      if(eid.source===d.id&&nodeMap[eid.target])conns.push({label:nodeMap[eid.target].label,type:eid.edgeType,weight:eid.weight,note:eid.note});
      if(eid.target===d.id&&nodeMap[eid.source])conns.push({label:nodeMap[eid.source].label,type:eid.edgeType,weight:eid.weight,note:eid.note});
    });
    if(conns.length){
      md+='## Connections\n\n';
      conns.forEach(function(c){
        md+='- [['+c.label+']]';
        if(c.type)md+=' ('+c.type+')';
        if(c.note)md+=' — '+c.note;
        md+='\n';
      });
    }
    files.push({name:d.label.replace(/[\/\\:*?"<>|]/g,'_')+'.md',content:md});
  });
  // Create zip-like download (single combined file for simplicity)
  var combined='# Mentegraf Obsidian Export\n\n';
  combined+='> '+files.length+' files — copy each section into separate .md files in your vault\n\n---\n\n';
  files.forEach(function(f){combined+='# FILE: '+f.name+'\n\n'+f.content+'\n---\n\n'});
  var blob=new Blob([combined],{type:'text/markdown'});
  var url=URL.createObjectURL(blob);var a=document.createElement('a');a.href=url;a.download='mentegraf-obsidian.md';
  document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
  closeExport();showMsg('Obsidian export')
}

/* ═══ SVG EXPORT ═══ */
function doExportSVG(){
  var nodes=[],edges=[];
  cy.nodes().forEach(function(n){if(!n.hasClass('filtered-out')){var d=n.data(),p=n.position();nodes.push({label:d.label,color:d.color,x:p.x,y:p.y,r:(n.data('_wsize')||32)/2})}});   // ← r added
  cy.edges().forEach(function(e){if(!e.hasClass('filtered-out')){var s=e.source().position(),t=e.target().position();edges.push({x1:s.x,y1:s.y,x2:t.x,y2:t.y,w:e.data('weight')||1})}});
  // Calculate bounds
  var minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  nodes.forEach(function(n){minX=Math.min(minX,n.x);minY=Math.min(minY,n.y);maxX=Math.max(maxX,n.x);maxY=Math.max(maxY,n.y)});
  var pad=80,w=maxX-minX+pad*2,h=maxY-minY+pad*2;
  var svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'" viewBox="'+(minX-pad)+' '+(minY-pad)+' '+w+' '+h+'">';
  svg+='<rect x="'+(minX-pad)+'" y="'+(minY-pad)+'" width="'+w+'" height="'+h+'" fill="'+(curTheme==='dark'?'#0f0f16':'#f5f2ec')+'"/>';
  edges.forEach(function(e){svg+='<line x1="'+e.x1+'" y1="'+e.y1+'" x2="'+e.x2+'" y2="'+e.y2+'" stroke="'+(curTheme==='dark'?'rgba(255,255,255,.15)':'rgba(0,0,0,.15)')+'" stroke-width="'+Math.max(.5,e.w)+'" />'});
  nodes.forEach(function(n){
    svg+='<circle cx="'+n.x+'" cy="'+n.y+'" r="'+n.r+'" fill="'+n.color+'" stroke="'+n.color+'" stroke-width="2" stroke-opacity=".3"/>';   // ← r used
    svg+='<text x="'+n.x+'" y="'+(n.y+n.r+14)+'" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="'+(curTheme==='dark'?'#d4d2c8':'#2c2820')+'">'+n.label+'</text>';   // ← label offset follows r
  });
  svg+='</svg>';
  var blob=new Blob([svg],{type:'image/svg+xml'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='mentegraf.svg';
  document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
  closeExport();showMsg('SVG export')
}

/* ═══ CSV EXPORT ═══ */
function doExportCSV(){
  var nodesCSV='id,label,type,description,tags\n';
  cy.nodes().forEach(function(n){var d=n.data();var cat=catById(d.type);nodesCSV+='"'+d.id+'","'+d.label+'","'+(cat?catLabel(cat):d.type)+'","'+(d.description||'').replace(/"/g,'""')+'","'+(d.tags||[]).join(';')+'"\n'});
  var edgesCSV='source,target,type,weight,note\n';
  cy.edges().forEach(function(e){var d=e.data();edgesCSV+='"'+e.source().data('label')+'","'+e.target().data('label')+'","'+(d.edgeType||'')+'",'+d.weight+',"'+(d.note||'').replace(/"/g,'""')+'"\n'});
  var combined='=== NODES ===\n'+nodesCSV+'\n=== EDGES ===\n'+edgesCSV;
  var blob=new Blob([combined],{type:'text/csv'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='mentegraf-data.csv';
  document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
  closeExport();showMsg('CSV export')
}



function showMsg(t){var m=document.getElementById('ml');m.innerHTML='<span style="color:var(--accent)">✓ '+t+'</span>';setTimeout(function(){m.textContent=''},2000)}
function uStats(){var vn=cy?cy.nodes().filter(function(n){return!n.hasClass('filtered-out')}).length:0;var ve=cy?cy.edges().filter(function(e){return!e.hasClass('filtered-out')}).length:0;document.getElementById('stats').textContent=vn+' / '+ve}

if(window.mentegraf){window.mentegraf.onMenuAction(function(a){if(a==='add-node')addNodeFree();if(a==='delete')delSel();if(a==='relayout')doLayout();if(a==='fit')cy.fit(null,50);if(a==='save')doSave();if(a==='new'){initConfig();init();clrSel()}if(a==='undo')undo();if(a==='redo')redo()});window.mentegraf.onFileOpened(function(data){loadProject(data)})}

document.addEventListener('DOMContentLoaded',async function(){
  await loadConfigs();
  await loadLangs();

  var st=localStorage.getItem('mentegraf-theme');if(st){curTheme=st;document.documentElement.setAttribute('data-theme',curTheme)}
  curLang=localStorage.getItem('mentegraf-lang')||'tr';initConfig();applyLang();init();doLoad();
  if(cy.nodes().length===0){cy.add({data:{id:'n1',label:L('bookTitle'),type:'book',color:catById('book').color,description:'',notes:'',tags:[]},position:{x:400,y:300}});nid=2}
  cy.fit(null,100);uStats();snapshot();startAutoSave()});
