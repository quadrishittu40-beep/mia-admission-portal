
const LOGO_SRC = "logo.png";

/* ============================= State ============================= */
const DEFAULT_ADMIN_ACCESS_CODE = 'MIA-ADMIN-2026';
const DEFAULT_STAFF_ACCESS_CODE = 'MIA-STAFF-2026';
let accessCodes = { adminCode: DEFAULT_ADMIN_ACCESS_CODE, staffCode: DEFAULT_STAFF_ACCESS_CODE };

const S = {
  role: null,
  staffName: '',
  gateMode: 'staff',       // 'staff' | 'parent'
  view: 'dashboard',
  sidebarOpen: false,
  sections: [],
  students: [],
  attendanceThreshold: 85,
  selectedSectionId: null,
  selectedDate: todayStr(),
  attendanceDraft: {},     // studentId -> {status, note}
  attendanceDocMeta: null, // {markedBy, markedAt} for currently loaded doc
  dirty: false,
  studentSearch: '',
  reportFrom: null,
  reportTo: null,
  reportSectionId: 'all',
  reportRows: [],
  reportLoading: false,
  dashboard: {loading:true, today:null, trend:null, chronic:[]},
  notesStudentId: null,
  notesList: [],
  notesLoading:false,
  importText: '',
  importFileName: '',
  importRows: null,     // parsed rows, or null before parsing
  importRunning: false,
  importProgress: {done:0, total:0},
  importResult: null,   // {added, sectionsCreated, skipped}
  parentStudentId: null,
  parentData: null,
  parentLoading: false,
  parentError: '',
};

const sb = window.supabase.createClient(window.MIA_CONFIG.SUPABASE_URL, window.MIA_CONFIG.SUPABASE_ANON_KEY);
let sectionsChannel = null, studentsChannel = null;
let trendChart = null;

function downloadTextFile(filename, text, mime){
  const blob = new Blob([text], {type:(mime||'text/csv')+';charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url), 2000);
}

function rowToSection(r){ return {id:r.id, name:r.name, gradeLevel:r.grade_level||'', adviser:r.adviser||'', createdAt:r.created_at}; }
function rowToStudent(r){ return {id:r.id, name:r.name, lrn:r.lrn||'', sectionId:r.section_id||'', guardianName:r.guardian_name||'', guardianContact:r.guardian_contact||'', status:r.status||'active', createdAt:r.created_at}; }
function rowToAttendance(r){ return {sectionId:r.section_id, date:r.date, records:r.records||{}, markedBy:r.marked_by, markedAt:r.marked_at}; }
function rowToNote(r){ return {id:r.id, studentId:r.student_id, author:r.author||'Staff', text:r.text, createdAt:r.created_at}; }

function todayStr(d = new Date()){
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off*60000);
  return local.toISOString().slice(0,10);
}
function daysAgoStr(n){
  const d = new Date();
  d.setDate(d.getDate()-n);
  return todayStr(d);
}
function fmtDate(s){
  if(!s) return '';
  const [y,m,d] = s.split('-').map(Number);
  return new Date(y,m-1,d).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
}
function fmtDateShort(s){
  const [y,m,d] = s.split('-').map(Number);
  return new Date(y,m-1,d).toLocaleDateString(undefined,{month:'short',day:'numeric'});
}
function initials(name){
  return (name||'?').split(' ').filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join('');
}
function esc(s){
  return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ---- CSV / roster import ---- */
function parseDelimited(text){
  const clean = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').trim();
  if(!clean) return [];
  const firstLine = clean.split('\n')[0];
  const delim = (firstLine.match(/\t/g)||[]).length >= (firstLine.match(/,/g)||[]).length ? '\t' : ',';
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for(let i=0;i<clean.length;i++){
    const c = clean[i], next = clean[i+1];
    if(inQuotes){
      if(c==='"' && next==='"'){ field+='"'; i++; }
      else if(c==='"'){ inQuotes=false; }
      else field += c;
    } else {
      if(c==='"') inQuotes = true;
      else if(c===delim){ row.push(field); field=''; }
      else if(c==='\n'){ row.push(field); rows.push(row); row=[]; field=''; }
      else field += c;
    }
  }
  row.push(field); rows.push(row);
  return rows.filter(r=>r.some(f=>f.trim()!==''));
}
const HEADER_ALIASES = {
  name: ['name','full name','student name','fullname'],
  lrn: ['id','lrn','student id','studentid','id / lrn','id/lrn'],
  section: ['section','class','grade section','grade & section'],
  guardianName: ['guardian','guardian name','parent','parent name','guardian/parent'],
  guardianContact: ['guardian contact','contact','phone','parent contact','guardian phone','contact number'],
};
function matchHeader(cell){
  const c = cell.trim().toLowerCase();
  for(const [field, aliases] of Object.entries(HEADER_ALIASES)){
    if(aliases.includes(c)) return field;
  }
  return null;
}
function parseRoster(text){
  const table = parseDelimited(text);
  if(!table.length) return {rows:[], error:'No rows found.'};
  const headerRow = table[0].map(h=>matchHeader(h));
  const hasName = headerRow.includes('name');
  if(!hasName){
    return {rows:[], error:"Couldn't find a \"Name\" column. First row must be a header with a Name column (and optionally ID/LRN, Section, Guardian Name, Guardian Contact)."};
  }
  const dataRows = table.slice(1);
  const rows = dataRows.map((r,idx)=>{
    const obj = {name:'', lrn:'', section:'', guardianName:'', guardianContact:''};
    headerRow.forEach((field, i)=>{
      if(field && r[i]!==undefined) obj[field]=r[i].trim();
    });
    const errors = [];
    if(!obj.name) errors.push('Missing name');
    return {...obj, line: idx+2, errors};
  });
  return {rows, error:null};
}
function toast(msg){
  const root = document.getElementById('toast-root');
  root.innerHTML = '<div class="toast">'+esc(msg)+'</div>';
  clearTimeout(toast._t);
  toast._t = setTimeout(()=>{ root.innerHTML=''; }, 2600);
}
function sectionName(id){
  const sec = S.sections.find(x=>x.id===id);
  return sec ? sec.name : '—';
}
function studentsInSection(id){
  return S.students.filter(s=>s.sectionId===id && s.status!=='inactive');
}
function saveLocal(){
  try{
    localStorage.setItem('mia_role', S.role || '');
    localStorage.setItem('mia_staff_name', S.staffName || '');
    localStorage.setItem('mia_parent_student_id', S.parentStudentId || '');
  }catch(e){}
}
function loadLocal(){
  try{
    S.role = localStorage.getItem('mia_role') || null;
    S.staffName = localStorage.getItem('mia_staff_name') || '';
    S.parentStudentId = localStorage.getItem('mia_parent_student_id') || null;
  }catch(e){}
}

/* ============================= App init ============================= */
async function fetchAccessCodes(){
  try{
    const {data, error} = await sb.from('config').select('value').eq('key','access').maybeSingle();
    if(error) throw error;
    if(data && data.value){
      accessCodes = {
        adminCode: data.value.adminCode || DEFAULT_ADMIN_ACCESS_CODE,
        staffCode: data.value.staffCode || DEFAULT_STAFF_ACCESS_CODE,
      };
    }
  }catch(e){ console.error('access config load', e); }
}

async function refreshSections(){
  try{
    const {data, error} = await sb.from('sections').select('*').order('name', {ascending:true});
    if(error) throw error;
    S.sections = (data||[]).map(rowToSection);
    if(!S.selectedSectionId && S.sections.length) S.selectedSectionId = S.sections[0].id;
    if(S.reportSectionId===undefined) S.reportSectionId='all';
    render();
  }catch(e){ console.error('sections load', e); }
}
async function refreshStudents(){
  try{
    const {data, error} = await sb.from('students').select('*').order('name', {ascending:true});
    if(error) throw error;
    S.students = (data||[]).map(rowToStudent);
    render();
  }catch(e){ console.error('students load', e); }
}

async function initApp(){
  await fetchAccessCodes();
  await refreshSections();
  await refreshStudents();

  sectionsChannel = sb.channel('sections-changes')
    .on('postgres_changes', {event:'*', schema:'public', table:'sections'}, ()=>{ refreshSections(); })
    .subscribe();
  studentsChannel = sb.channel('students-changes')
    .on('postgres_changes', {event:'*', schema:'public', table:'students'}, ()=>{ refreshStudents(); })
    .subscribe();

  render();
  if(S.role==='parent' && S.parentStudentId){ loadParentAttendance(S.parentStudentId); }
  else if(S.role){ loadAttendanceForSelection(); loadDashboard(); }
}

/* ============================= Attendance loading ============================= */
async function loadAttendanceForSelection(){
  if(!S.selectedSectionId){ S.attendanceDraft={}; S.attendanceDocMeta=null; render(); return; }
  const roster = studentsInSection(S.selectedSectionId);
  const draft = {};
  roster.forEach(st=>{ draft[st.id] = {status:null, note:''}; });
  try{
    const {data, error} = await sb.from('attendance').select('*')
      .eq('section_id', S.selectedSectionId).eq('date', S.selectedDate).maybeSingle();
    if(error) throw error;
    if(data){
      S.attendanceDocMeta = {markedBy:data.marked_by, markedAt:data.marked_at};
      const recs = data.records || {};
      roster.forEach(st=>{
        if(recs[st.id]) draft[st.id] = {status:recs[st.id].status||null, note:recs[st.id].note||''};
      });
    } else {
      S.attendanceDocMeta = null;
    }
  }catch(e){ console.error(e); }
  S.attendanceDraft = draft;
  S.dirty = false;
  render();
}

async function saveAttendance(){
  if(!S.selectedSectionId) return;
  const records = {};
  Object.keys(S.attendanceDraft).forEach(sid=>{
    const rec = S.attendanceDraft[sid];
    if(rec.status) records[sid] = {status:rec.status, note:rec.note||''};
  });
  const btn = document.getElementById('save-attendance-btn');
  if(btn){ btn.disabled = true; btn.textContent = 'Saving…'; }
  try{
    const {error} = await sb.from('attendance').upsert({
      section_id: S.selectedSectionId,
      date: S.selectedDate,
      records,
      marked_by: S.staffName || 'Staff',
      marked_at: new Date().toISOString(),
    }, {onConflict:'section_id,date'});
    if(error) throw error;
    S.attendanceDocMeta = {markedBy:S.staffName||'Staff', markedAt:new Date().toISOString()};
    S.dirty = false;
    toast('Attendance saved for '+sectionName(S.selectedSectionId)+' — '+fmtDate(S.selectedDate));
    loadDashboard();
  }catch(e){
    console.error(e);
    toast('Could not save attendance. Please try again.');
  }
  render();
}

function setStatus(studentId, status){
  const cur = S.attendanceDraft[studentId] || {status:null, note:''};
  S.attendanceDraft[studentId] = {...cur, status: cur.status===status ? null : status};
  S.dirty = true;
  render();
}
function setNote(studentId, note){
  const cur = S.attendanceDraft[studentId] || {status:null, note:''};
  S.attendanceDraft[studentId] = {...cur, note};
  S.dirty = true;
}
function markAll(status){
  const roster = studentsInSection(S.selectedSectionId);
  roster.forEach(st=>{
    const cur = S.attendanceDraft[st.id] || {status:null, note:''};
    S.attendanceDraft[st.id] = {...cur, status};
  });
  S.dirty = true;
  render();
}

/* ============================= Dashboard data ============================= */
async function loadDashboard(){
  S.dashboard.loading = true; render();
  try{
    const today = todayStr();
    const {data: todayRaw, error: e1} = await sb.from('attendance').select('*').eq('date', today);
    if(e1) throw e1;
    const todayRows = (todayRaw||[]).map(rowToAttendance);
    const counts = {present:0, absent:0, late:0, excused:0};
    const markedSections = new Set();
    todayRows.forEach(data=>{
      markedSections.add(data.sectionId);
      Object.values(data.records||{}).forEach(r=>{ if(counts[r.status]!==undefined) counts[r.status]++; });
    });
    const unmarked = S.sections.filter(sec=>!markedSections.has(sec.id));
    const totalMarked = counts.present+counts.absent+counts.late+counts.excused;
    const rate = totalMarked ? Math.round(((counts.present+counts.late)/totalMarked)*100) : null;

    const from = daysAgoStr(20);
    const {data: rangeRaw, error: e2} = await sb.from('attendance').select('*').gte('date',from).lte('date',today);
    if(e2) throw e2;
    const rangeRows = (rangeRaw||[]).map(rowToAttendance);
    const byDate = {};
    rangeRows.forEach(data=>{
      if(!byDate[data.date]) byDate[data.date] = {present:0,absent:0,late:0,excused:0};
      Object.values(data.records||{}).forEach(r=>{ if(byDate[data.date][r.status]!==undefined) byDate[data.date][r.status]++; });
    });
    const dates = Object.keys(byDate).sort();
    const trend = dates.map(dt=>{
      const c = byDate[dt];
      const tot = c.present+c.absent+c.late+c.excused;
      return {date:dt, rate: tot ? Math.round(((c.present+c.late)/tot)*100) : null};
    });

    const perStudent = {};
    rangeRows.forEach(data=>{
      Object.entries(data.records||{}).forEach(([sid,r])=>{
        if(!perStudent[sid]) perStudent[sid] = {present:0,absent:0,late:0,excused:0};
        if(perStudent[sid][r.status]!==undefined) perStudent[sid][r.status]++;
      });
    });
    const chronic = Object.entries(perStudent).map(([sid,c])=>{
      const counted = c.present+c.absent+c.late;
      const rt = counted ? Math.round(((c.present+c.late)/counted)*100) : null;
      return {studentId:sid, rate:rt, counted, ...c};
    }).filter(x=>x.counted>=3 && x.rate!==null && x.rate < S.attendanceThreshold)
      .sort((a,b)=>a.rate-b.rate);

    S.dashboard = {loading:false, today:{counts, rate, unmarked, totalMarked}, trend, chronic};
  }catch(e){
    console.error(e);
    S.dashboard = {loading:false, today:null, trend:[], chronic:[]};
  }
  render();
}

/* ============================= Reports data ============================= */
async function loadReport(){
  S.reportLoading = true; render();
  const from = S.reportFrom || daysAgoStr(30);
  const to = S.reportTo || todayStr();
  try{
    let q = sb.from('attendance').select('*').gte('date',from).lte('date',to);
    if(S.reportSectionId && S.reportSectionId!=='all') q = q.eq('section_id', S.reportSectionId);
    const {data: raw, error} = await q;
    if(error) throw error;
    const rows2 = (raw||[]).map(rowToAttendance);
    const perStudent = {};
    rows2.forEach(data=>{
      Object.entries(data.records||{}).forEach(([sid,r])=>{
        if(!perStudent[sid]) perStudent[sid] = {present:0,absent:0,late:0,excused:0};
        if(perStudent[sid][r.status]!==undefined) perStudent[sid][r.status]++;
      });
    });
    const rows = S.students.filter(st=> S.reportSectionId==='all' || st.sectionId===S.reportSectionId)
      .map(st=>{
        const c = perStudent[st.id] || {present:0,absent:0,late:0,excused:0};
        const counted = c.present+c.absent+c.late;
        const rate = counted ? Math.round(((c.present+c.late)/counted)*100) : null;
        return {student:st, ...c, counted, rate};
      }).sort((a,b)=>{
        if(a.rate===null) return 1;
        if(b.rate===null) return -1;
        return a.rate-b.rate;
      });
    S.reportRows = rows;
  }catch(e){
    console.error(e);
    S.reportRows = [];
  }
  S.reportLoading = false;
  render();
}

async function exportReportCsv(){
  const lines = [['Student','LRN / ID','Section','Present','Absent','Late','Excused','Attendance Rate']];
  S.reportRows.forEach(r=>{
    lines.push([r.student.name, r.student.lrn||'', sectionName(r.student.sectionId), r.present, r.absent, r.late, r.excused, r.rate===null?'—':r.rate+'%']);
  });
  const csv = lines.map(row=>row.map(v=>{
    const s = String(v);
    return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
  }).join(',')).join('\n');
  downloadTextFile('attendance-report-'+(S.reportFrom||'')+'-to-'+(S.reportTo||'')+'.csv', csv, 'text/csv');
  toast('Report downloaded.');
}

function loadImageAsDataUrl(url){
  return fetch(url)
    .then(resp => resp.blob())
    .then(blob => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    }));
}

function generateQrDataUrl(text, size){
  return new Promise((resolve) => {
    const holder = document.createElement('div');
    holder.style.position = 'fixed';
    holder.style.left = '-9999px';
    document.body.appendChild(holder);
    try{
      new QRCode(holder, {
        text, width: size || 240, height: size || 240,
        correctLevel: QRCode.CorrectLevel.M,
      });
    }catch(e){ document.body.removeChild(holder); resolve(''); return; }
    setTimeout(() => {
      const canvas = holder.querySelector('canvas');
      const dataUrl = canvas ? canvas.toDataURL('image/png') : '';
      document.body.removeChild(holder);
      resolve(dataUrl);
    }, 60);
  });
}

async function exportReportPdf(){
  if(!S.reportRows.length){ toast('Run a report first.'); return; }
  const btn = document.getElementById('export-pdf-btn');
  if(btn){ btn.disabled = true; btn.textContent = 'Preparing…'; }
  try{
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:'pt', format:'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    const [logoDataUrl, qrDataUrl] = await Promise.all([
      loadImageAsDataUrl('./logo.png').catch(()=>''),
      generateQrDataUrl(location.href, 240).catch(()=>''),
    ]);

    const fromLabel = S.reportFrom ? fmtDate(S.reportFrom) : '—';
    const toLabel = S.reportTo ? fmtDate(S.reportTo) : '—';
    const sectionLabel = S.reportSectionId==='all' ? 'All sections' : sectionName(S.reportSectionId);

    function drawHeader(){
      doc.setFillColor(248,244,232);
      doc.rect(0,0,pageWidth,96,'F');
      if(logoDataUrl){ try{ doc.addImage(logoDataUrl,'PNG',40,18,58,58); }catch(e){} }
      doc.setTextColor(27,92,66);
      doc.setFont('helvetica','bold');
      doc.setFontSize(16);
      doc.text("Maknazul 'Irfan Academy", 112, 40);
      doc.setFont('helvetica','normal');
      doc.setFontSize(11);
      doc.setTextColor(90,90,90);
      doc.text('Student Attendance Report', 112, 58);
      doc.setFontSize(9);
      doc.text(fromLabel+' to '+toLabel+'   ·   '+sectionLabel, 112, 74);
      doc.setDrawColor(222,210,174);
      doc.line(40,96,pageWidth-40,96);
    }

    // Table drawn by hand (no autoTable plugin — fewer moving parts, no
    // version-compatibility surprises with jsPDF).
    const headerHeight = 96;
    const bottomMargin = 56;
    const marginLeft = 40;
    const cols = [
      { key:'name',    label:'Student',  width:150, align:'left'   },
      { key:'section', label:'Section',  width:110, align:'left'   },
      { key:'present', label:'Present',  width:48,  align:'center' },
      { key:'late',    label:'Late',     width:40,  align:'center' },
      { key:'absent',  label:'Absent',   width:48,  align:'center' },
      { key:'excused', label:'Excused',  width:55,  align:'center' },
      { key:'rate',    label:'Rate',     width:49,  align:'center' },
    ];
    const tableWidth = cols.reduce((sum,c) => sum + c.width, 0);
    const rowHeight = 22;
    const headRowHeight = 24;

    function colX(i){
      let x = marginLeft;
      for(let k=0; k<i; k++) x += cols[k].width;
      return x;
    }
    function cellText(doc, text, col, x, y){
      const maxChars = Math.max(3, Math.floor(col.width / 4.3));
      let t = String(text);
      if(t.length > maxChars) t = t.slice(0, maxChars-1) + '…';
      const tx = col.align==='left' ? x + 6 : x + col.width/2;
      doc.text(t, tx, y, { align: col.align==='left' ? 'left' : 'center' });
    }
    function drawTableHead(y){
      doc.setFillColor(27,92,66);
      doc.rect(marginLeft, y, tableWidth, headRowHeight, 'F');
      doc.setTextColor(255,255,255);
      doc.setFont('helvetica','bold');
      doc.setFontSize(9);
      cols.forEach((c,i) => cellText(doc, c.label, c, colX(i), y+16));
      doc.setFont('helvetica','normal');
      doc.setTextColor(30,38,32);
      return y + headRowHeight;
    }

    drawHeader();
    let y = drawTableHead(headerHeight + 18);

    S.reportRows.forEach((r, idx) => {
      if(y + rowHeight > pageHeight - bottomMargin){
        doc.addPage();
        drawHeader();
        y = drawTableHead(headerHeight + 18);
      }
      if(idx % 2 === 1){
        doc.setFillColor(248,244,232);
        doc.rect(marginLeft, y, tableWidth, rowHeight, 'F');
      }
      doc.setFontSize(9);
      doc.setTextColor(30,38,32);
      const rowVals = {
        name: r.student.name,
        section: sectionName(r.student.sectionId),
        present: r.present, late: r.late, absent: r.absent, excused: r.excused,
        rate: r.rate===null ? '—' : r.rate+'%',
      };
      cols.forEach((c,i) => cellText(doc, rowVals[c.key], c, colX(i), y+15));
      doc.setDrawColor(222,210,174);
      doc.line(marginLeft, y+rowHeight, marginLeft+tableWidth, y+rowHeight);
      y += rowHeight;
    });

    const totalPages = doc.internal.getNumberOfPages();
    for(let p=1; p<=totalPages; p++){
      doc.setPage(p);
      doc.setFontSize(8);
      doc.setTextColor(140,140,140);
      doc.text(
        'Generated '+new Date().toLocaleString()+' by '+(S.staffName||'Staff')+'   ·   Page '+p+' of '+totalPages,
        40, pageHeight-24
      );
    }

    if(qrDataUrl){
      doc.setPage(totalPages);
      const qrSize = 66;
      const qx = pageWidth-40-qrSize, qy = pageHeight-56-qrSize;
      try{
        doc.addImage(qrDataUrl,'PNG',qx,qy,qrSize,qrSize);
        doc.setFontSize(7);
        doc.setTextColor(120,120,120);
        doc.text('Scan to open the portal', qx, qy-6);
      }catch(e){}
    }

    doc.save('attendance-report-'+(S.reportFrom||'')+'-to-'+(S.reportTo||'')+'.pdf');
    toast('PDF downloaded.');
  }catch(e){
    console.error(e);
    toast('PDF error: '+(e && e.message ? e.message : String(e)));
  }
  if(btn){ btn.disabled = false; btn.textContent = 'Export PDF'; }
}

/* ============================= Parent / Guardian data ============================= */
async function loadParentAttendance(studentId){
  const st = S.students.find(x=>x.id===studentId);
  if(!st){ S.parentLoading = false; render(); return; }
  S.parentLoading = true; render();
  try{
    const from = daysAgoStr(120);
    const to = todayStr();
    const {data: raw, error} = await sb.from('attendance').select('*')
      .eq('section_id', st.sectionId).gte('date',from).lte('date',to);
    if(error) throw error;
    const dataRows = (raw||[]).map(rowToAttendance);
    const rows = [];
    dataRows.forEach(data=>{
      const rec = (data.records||{})[studentId];
      if(rec) rows.push({date:data.date, status:rec.status, note:rec.note||''});
    });
    rows.sort((a,b)=> b.date.localeCompare(a.date));
    const counts = {present:0,absent:0,late:0,excused:0};
    rows.forEach(r=>{ if(counts[r.status]!==undefined) counts[r.status]++; });
    const counted = counts.present+counts.absent+counts.late;
    const rate = counted ? Math.round(((counts.present+counts.late)/counted)*100) : null;
    S.parentData = {student:st, rows, counts, rate};
  }catch(e){
    console.error(e);
    S.parentData = {student:st, rows:[], counts:{present:0,absent:0,late:0,excused:0}, rate:null};
  }
  S.parentLoading = false;
  render();
}

/* ============================= Notes ============================= */
async function loadNotes(studentId){
  S.notesLoading = true; render();
  try{
    const {data, error} = await sb.from('notes').select('*').eq('student_id', studentId)
      .order('created_at', {ascending:false}).limit(50);
    if(error) throw error;
    S.notesList = (data||[]).map(rowToNote);
  }catch(e){ console.error(e); S.notesList = []; }
  S.notesLoading = false;
  render();
}
async function addNote(studentId, text){
  if(!text.trim()) return;
  try{
    const {error} = await sb.from('notes').insert({
      student_id: studentId, author: S.staffName || 'Staff', text: text.trim(),
    });
    if(error) throw error;
    toast('Note added.');
    loadNotes(studentId);
  }catch(e){ console.error(e); toast('Could not save the note.'); }
}

/* ============================= CRUD: sections & students ============================= */
async function addSection(data){
  const {data:row, error} = await sb.from('sections').insert({
    name:data.name, grade_level:data.gradeLevel||null, adviser:data.adviser||null,
  }).select('id').single();
  if(error) throw error;
  return row.id;
}
async function updateSection(id, data){
  const patch = {};
  if('name' in data) patch.name = data.name;
  if('gradeLevel' in data) patch.grade_level = data.gradeLevel;
  if('adviser' in data) patch.adviser = data.adviser;
  const {error} = await sb.from('sections').update(patch).eq('id', id);
  if(error) throw error;
}
async function deleteSection(id){
  const {error} = await sb.from('sections').delete().eq('id', id);
  if(error) throw error;
}
async function addStudent(data){
  const {error} = await sb.from('students').insert({
    name:data.name, lrn:data.lrn||null, section_id:data.sectionId||null,
    guardian_name:data.guardianName||null, guardian_contact:data.guardianContact||null, status:'active',
  });
  if(error) throw error;
}
async function updateStudent(id, data){
  const patch = {};
  if('name' in data) patch.name = data.name;
  if('lrn' in data) patch.lrn = data.lrn;
  if('sectionId' in data) patch.section_id = data.sectionId;
  if('guardianName' in data) patch.guardian_name = data.guardianName;
  if('guardianContact' in data) patch.guardian_contact = data.guardianContact;
  if('status' in data) patch.status = data.status;
  const {error} = await sb.from('students').update(patch).eq('id', id);
  if(error) throw error;
}
async function deleteStudent(id){
  const {error} = await sb.from('students').delete().eq('id', id);
  if(error) throw error;
}

/* ============================= Render: shell ============================= */
function navIcon(name){
  const icons = {
    dashboard:'<path d="M3 13h8V3H3v10Zm10 8h8V9h-8v12ZM3 21h8v-6H3v6ZM13 3v4h8V3h-8Z"/>',
    attendance:'<path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    students:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    sections:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    reports:'<path d="M3 3v18h18"/><path d="M7 15l4-6 3 4 5-8"/>',
    notes:'<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  };
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+icons[name]+'</svg>';
}

const NAV_ALL = [
  {id:'dashboard', label:'Dashboard', icon:'dashboard', roles:['admin','teacher']},
  {id:'attendance', label:'Take Attendance', icon:'attendance', roles:['teacher']},
  {id:'students', label:'Students', icon:'students', roles:['admin','teacher']},
  {id:'sections', label:'Sections', icon:'sections', roles:['admin','teacher']},
  {id:'reports', label:'Reports', icon:'reports', roles:['admin','teacher']},
  {id:'notes', label:'Staff Notes', icon:'notes', roles:['admin','teacher']},
  {id:'settings', label:'Access Codes', icon:'settings', roles:['admin']},
];
function navForRole(role){
  return NAV_ALL.filter(n=>n.roles.includes(role));
}

function roleLabel(r){
  return {admin:'Administrator', teacher:'Teacher / Staff', parent:'Parent / Guardian'}[r] || r;
}

function renderShell(inner){
  const nav = navForRole(S.role);
  return `
  <div class="sidebar-backdrop ${S.sidebarOpen?'show':''}" data-action="close-sidebar"></div>
  <div class="sidebar ${S.sidebarOpen?'open':''}">
    <div class="brand">
      <img src="${LOGO_SRC}" alt="Academy crest">
      <div>
        <div class="brand-name">Maknazul 'Irfan<br>Academy</div>
        <div class="brand-tag">ATTENDANCE PORTAL</div>
      </div>
    </div>
    <nav class="nav">
      ${nav.map(n=>`
        <button class="nav-item ${S.view===n.id?'active':''}" data-action="nav" data-view="${n.id}">
          ${navIcon(n.icon)}<span>${n.label}</span>
        </button>`).join('')}
    </nav>
    <div class="sidebar-foot">
      <div class="who">
        <b>${esc(S.staffName || 'Staff')}</b>
        <span class="role-tag">${esc(roleLabel(S.role))}</span>
      </div>
      <button class="signout" data-action="signout">Switch account</button>
    </div>
  </div>
  <div class="main">
    <button class="menu-toggle" data-action="open-sidebar">☰ Menu</button>
    ${inner}
  </div>`;
}

function renderParentShell(inner){
  return `
  <div class="main" style="max-width:900px;">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:24px;flex-wrap:wrap;">
      <div style="display:flex;align-items:center;gap:12px;">
        <img src="${LOGO_SRC}" alt="Academy crest" style="width:44px;height:44px;object-fit:contain;">
        <div>
          <div class="serif" style="font-weight:600;font-size:1.05rem;color:var(--green-900);">Maknazul 'Irfan Academy</div>
          <div class="small muted">Parent / Guardian Attendance View</div>
        </div>
      </div>
      <button class="btn btn-ghost btn-sm" data-action="signout">Sign out</button>
    </div>
    ${inner}
  </div>`;
}

/* ============================= Render: Dashboard ============================= */
function renderDashboard(){
  const d = S.dashboard;
  if(d.loading){
    return renderShell(`<div class="page-head"><div><h1>Dashboard</h1><p>Loading today's attendance…</p></div></div>`);
  }
  const t = d.today;
  const rate = t && t.rate!==null ? t.rate+'%' : '—';
  return renderShell(`
    <div class="page-head">
      <div>
        <h1>Dashboard</h1>
        <p>${fmtDate(todayStr())} · school-wide overview</p>
      </div>
      <button class="btn btn-ghost btn-sm" data-action="refresh-dashboard">Refresh</button>
    </div>

    <div class="stat-row">
      <div class="stat-card"><div class="n">${rate}</div><div class="l">Today's attendance rate</div></div>
      <div class="stat-card present"><div class="n">${t?t.counts.present:0}</div><div class="l">Present</div></div>
      <div class="stat-card absent"><div class="n">${t?t.counts.absent:0}</div><div class="l">Absent</div></div>
      <div class="stat-card late"><div class="n">${t?t.counts.late:0}</div><div class="l">Late</div></div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>14-day attendance trend</h2><span class="small muted">Present + late ÷ marked students</span></div>
      <div class="chart-wrap"><canvas id="trend-canvas"></canvas></div>
    </div>

    ${t && t.unmarked.length ? `
    <div class="panel">
      <div class="panel-head"><h2>Not yet marked today</h2></div>
      <div class="panel-body">
        <div style="display:flex;flex-wrap:wrap;gap:8px;">
          ${t.unmarked.map(sec=>`<span class="section-chip" style="cursor:pointer;" data-action="goto-attendance" data-id="${sec.id}">${esc(sec.name)}</span>`).join('')}
        </div>
      </div>
    </div>` : ''}

    <div class="panel">
      <div class="panel-head">
        <h2>Chronic absenteeism alerts</h2>
        <span class="small muted">Below ${S.attendanceThreshold}% over last 20 marked days</span>
      </div>
      ${d.chronic.length ? `<div>
        ${d.chronic.slice(0,8).map(c=>{
          const st = S.students.find(x=>x.id===c.studentId);
          if(!st) return '';
          return `<div class="alert-row">
            <div>
              <div class="alert-name">${esc(st.name)}</div>
              <div class="small muted">${esc(sectionName(st.sectionId))} · ${c.present+c.late}/${c.counted} present or late</div>
            </div>
            <div style="display:flex;align-items:center;gap:12px;">
              <div class="alert-rate">${c.rate}%</div>
              <button class="btn btn-ghost btn-sm" data-action="goto-notes" data-id="${st.id}">Add note</button>
            </div>
          </div>`;
        }).join('')}
      </div>` : `<div class="empty">No students currently below the threshold — nicely kept.</div>`}
    </div>
  `);
}

/* ============================= Render: Take Attendance ============================= */
function renderAttendance(){
  const roster = S.selectedSectionId ? studentsInSection(S.selectedSectionId) : [];
  const counts = {present:0,absent:0,late:0,excused:0,unmarked:0};
  roster.forEach(st=>{
    const rec = S.attendanceDraft[st.id];
    if(rec && rec.status) counts[rec.status]++;
    else counts.unmarked++;
  });
  return renderShell(`
    <div class="page-head">
      <div><h1>Take Attendance</h1><p>Mark each student, then save. Everyone with portal access sees the update right away.</p></div>
    </div>

    <div class="panel">
      <div class="panel-head" style="gap:14px;">
        <div class="toolbar">
          <select data-action="select-section">
            ${S.sections.length ? S.sections.map(sec=>`<option value="${sec.id}" ${sec.id===S.selectedSectionId?'selected':''}>${esc(sec.name)}</option>`).join('') : '<option value="">No sections yet</option>'}
          </select>
          <input type="date" value="${S.selectedDate}" data-action="select-date">
        </div>
        <div class="toolbar">
          <button class="btn btn-ghost btn-sm" data-action="mark-all" data-status="present">Mark all present</button>
        </div>
      </div>

      ${!S.sections.length ? `<div class="empty">Add a section first, in the Sections tab.</div>` :
        !roster.length ? `<div class="empty">No active students in this section yet. Add students in the Students tab.</div>` : `
      <div style="display:flex;gap:8px;padding:12px 20px 0;flex-wrap:wrap;">
        <span class="badge present">${counts.present} present</span>
        <span class="badge absent">${counts.absent} absent</span>
        <span class="badge late">${counts.late} late</span>
        <span class="badge excused">${counts.excused} excused</span>
        <span class="badge neutral">${counts.unmarked} unmarked</span>
      </div>
      <div class="tbl-wrap">
        <table>
          <thead><tr><th>Student</th><th>Status</th><th style="width:220px;">Note (optional)</th></tr></thead>
          <tbody>
            ${roster.map(st=>{
              const rec = S.attendanceDraft[st.id] || {status:null, note:''};
              return `<tr class="roster-row">
                <td>
                  <div class="roster-name">${esc(st.name)}</div>
                  <div class="roster-meta">${esc(st.lrn||'No ID on file')}</div>
                </td>
                <td>
                  <div class="status-set">
                    <button class="status-btn p ${rec.status==='present'?'on':''}" data-action="set-status" data-id="${st.id}" data-status="present">Present</button>
                    <button class="status-btn l ${rec.status==='late'?'on':''}" data-action="set-status" data-id="${st.id}" data-status="late">Late</button>
                    <button class="status-btn a ${rec.status==='absent'?'on':''}" data-action="set-status" data-id="${st.id}" data-status="absent">Absent</button>
                    <button class="status-btn e ${rec.status==='excused'?'on':''}" data-action="set-status" data-id="${st.id}" data-status="excused">Excused</button>
                  </div>
                </td>
                <td><input class="note-input" placeholder="e.g. reason" value="${esc(rec.note)}" data-action="set-note" data-id="${st.id}"></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <div class="save-bar">
        <div class="save-status">${S.attendanceDocMeta ? 'Last saved by '+esc(S.attendanceDocMeta.markedBy)+' · '+new Date(S.attendanceDocMeta.markedAt).toLocaleString() : 'Not yet saved for this date'}${S.dirty ? ' · <b style="color:var(--late);">unsaved changes</b>' : ''}</div>
        <button class="btn btn-gold" id="save-attendance-btn" data-action="save-attendance">Save attendance</button>
      </div>
      `}
    </div>
  `);
}

/* ============================= Render: Students ============================= */
function renderStudents(){
  const canEdit = S.role==='admin';
  const q = S.studentSearch.trim().toLowerCase();
  const rows = S.students.filter(st=>{
    if(!q) return true;
    return (st.name||'').toLowerCase().includes(q) || (st.lrn||'').toLowerCase().includes(q);
  });
  return renderShell(`
    <div class="page-head">
      <div><h1>Students</h1><p>${S.students.length} enrolled${S.sections.length? ' across '+S.sections.length+' sections':''}</p></div>
      ${canEdit ? `<div style="display:flex;gap:8px;">
        <button class="btn btn-ghost" data-action="open-import-modal">Import roster</button>
        <button class="btn btn-gold" data-action="open-student-modal">+ Add student</button>
      </div>` : ''}
    </div>
    <div class="panel">
      <div class="panel-head">
        <input class="search-input" placeholder="Search by name or ID…" value="${esc(S.studentSearch)}" data-action="search-students">
        <span class="small muted">${rows.length} shown</span>
      </div>
      <div class="tbl-wrap">
        ${rows.length ? `<table>
          <thead><tr><th>Name</th><th>ID / LRN</th><th>Section</th><th>Guardian contact</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${rows.map(st=>`<tr>
              <td class="roster-name">${esc(st.name)}</td>
              <td class="muted">${esc(st.lrn||'—')}</td>
              <td>${esc(sectionName(st.sectionId))}</td>
              <td class="muted">${esc(st.guardianName||'')}${st.guardianContact? ' · '+esc(st.guardianContact):''}</td>
              <td><span class="badge ${st.status==='inactive'?'neutral':'present'}">${st.status==='inactive'?'Inactive':'Active'}</span></td>
              <td>${canEdit?`<div style="display:flex;gap:6px;">
                <button class="btn btn-ghost btn-sm" data-action="edit-student" data-id="${st.id}">Edit</button>
                <button class="btn btn-danger btn-sm" data-action="delete-student" data-id="${st.id}">Remove</button>
              </div>`:''}</td>
            </tr>`).join('')}
          </tbody>
        </table>` : `<div class="empty">No students match yet.</div>`}
      </div>
    </div>
  `);
}

/* ============================= Render: Sections ============================= */
function renderSections(){
  const canEdit = S.role==='admin';
  return renderShell(`
    <div class="page-head">
      <div><h1>Sections</h1><p>Grade levels and class sections used across the portal.</p></div>
      ${canEdit ? `<button class="btn btn-gold" data-action="open-section-modal">+ Add section</button>` : ''}
    </div>
    <div class="panel">
      <div class="tbl-wrap">
        ${S.sections.length ? `<table>
          <thead><tr><th>Section</th><th>Grade level</th><th>Adviser</th><th>Enrolled</th><th></th></tr></thead>
          <tbody>
            ${S.sections.map(sec=>`<tr>
              <td class="roster-name">${esc(sec.name)}</td>
              <td class="muted">${esc(sec.gradeLevel||'—')}</td>
              <td class="muted">${esc(sec.adviser||'—')}</td>
              <td class="muted">${studentsInSection(sec.id).length}</td>
              <td>${canEdit?`<div style="display:flex;gap:6px;">
                <button class="btn btn-ghost btn-sm" data-action="edit-section" data-id="${sec.id}">Edit</button>
                <button class="btn btn-danger btn-sm" data-action="delete-section" data-id="${sec.id}">Remove</button>
              </div>`:''}</td>
            </tr>`).join('')}
          </tbody>
        </table>` : `<div class="empty">No sections yet. ${canEdit?'Add your first one above.':'Ask an administrator to add one.'}</div>`}
      </div>
    </div>
  `);
}

/* ============================= Render: Reports ============================= */
function renderReports(){
  if(S.reportFrom===null) S.reportFrom = daysAgoStr(30);
  if(S.reportTo===null) S.reportTo = todayStr();
  return renderShell(`
    <div class="page-head">
      <div><h1>Reports</h1><p>Attendance rates by student for a chosen date range.</p></div>
    </div>
    <div class="panel">
      <div class="panel-head" style="gap:14px;">
        <div class="toolbar">
          <input type="date" value="${S.reportFrom}" data-action="report-from">
          <span class="small muted">to</span>
          <input type="date" value="${S.reportTo}" data-action="report-to">
          <select data-action="report-section">
            <option value="all" ${S.reportSectionId==='all'?'selected':''}>All sections</option>
            ${S.sections.map(sec=>`<option value="${sec.id}" ${sec.id===S.reportSectionId?'selected':''}>${esc(sec.name)}</option>`).join('')}
          </select>
          <button class="btn btn-ghost btn-sm" data-action="run-report">Run report</button>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-ghost btn-sm" data-action="export-report" ${S.reportRows.length?'':'disabled'}>Export CSV</button>
          <button class="btn btn-gold btn-sm" id="export-pdf-btn" data-action="export-report-pdf" ${S.reportRows.length?'':'disabled'}>Export PDF</button>
        </div>
      </div>
      <div class="tbl-wrap">
        ${S.reportLoading ? `<div class="empty">Crunching attendance…</div>` :
          S.reportRows.length ? `<table>
          <thead><tr><th>Student</th><th>Section</th><th>Present</th><th>Late</th><th>Absent</th><th>Excused</th><th>Rate</th></tr></thead>
          <tbody>
            ${S.reportRows.map(r=>`<tr>
              <td class="roster-name">${esc(r.student.name)}</td>
              <td class="muted">${esc(sectionName(r.student.sectionId))}</td>
              <td>${r.present}</td>
              <td>${r.late}</td>
              <td>${r.absent}</td>
              <td>${r.excused}</td>
              <td>${r.rate===null ? '<span class="muted">—</span>' : `<span class="badge ${r.rate<S.attendanceThreshold?'flag':'present'}">${r.rate}%</span>`}</td>
            </tr>`).join('')}
          </tbody>
        </table>` : `<div class="empty">Run a report to see attendance rates for this range.</div>`}
      </div>
    </div>
  `);
}

/* ============================= Render: Guidance Notes ============================= */
function renderNotes(){
  const st = S.notesStudentId ? S.students.find(x=>x.id===S.notesStudentId) : null;
  return renderShell(`
    <div class="page-head">
      <div><h1>Staff Notes</h1><p>Attendance follow-ups and internal notes, kept with each student's record. Not visible to parents/guardians.</p></div>
    </div>
    <div class="panel">
      <div class="panel-head">
        <select data-action="notes-select-student">
          <option value="">Choose a student…</option>
          ${S.students.map(s=>`<option value="${s.id}" ${s.id===S.notesStudentId?'selected':''}>${esc(s.name)} — ${esc(sectionName(s.sectionId))}</option>`).join('')}
        </select>
      </div>
      ${!st ? `<div class="empty">Select a student to view or add staff notes.</div>` : `
      <div class="panel-body">
        <div class="field" style="margin-bottom:18px;">
          <label>New note</label>
          <textarea id="note-text" rows="3" placeholder="Follow-up on repeated absences, conversation summary, next steps…"></textarea>
          <div style="margin-top:8px;"><button class="btn btn-gold btn-sm" data-action="add-note" data-id="${st.id}">Add note</button></div>
        </div>
        <div class="notes-list">
          ${S.notesLoading ? `<div class="muted small">Loading notes…</div>` :
            S.notesList.length ? S.notesList.map(n=>`
            <div class="note-card">
              <div class="meta">${esc(n.author||'Staff')} · ${n.createdAt? new Date(n.createdAt).toLocaleString():''}</div>
              <div class="txt">${esc(n.text)}</div>
            </div>`).join('') : `<div class="muted small">No notes yet for this student.</div>`}
        </div>
      </div>`}
    </div>
  `);
}

/* ============================= Render: Settings (admin only) ============================= */
function renderSettings(){
  return renderShell(`
    <div class="page-head">
      <div><h1>Access Codes</h1><p>Shared sign-in codes for administrators and teaching staff. Change these periodically and share the new codes only with your staff.</p></div>
    </div>
    <div class="panel">
      <div class="panel-body">
        <div class="field"><label>Administrator access code</label><input id="cfg-admin-code" value="${esc(accessCodes.adminCode)}"></div>
        <div class="field"><label>Teacher / Staff access code</label><input id="cfg-staff-code" value="${esc(accessCodes.staffCode)}"></div>
        <button class="btn btn-gold" data-action="save-access-codes">Save codes</button>
        <p class="small muted" style="margin-top:16px;">These codes control entry to the staff side of the portal. They are a light gatekeeping step, not strong security — anyone who can already open this portal page could technically read this data, so don't reuse a code you use elsewhere. Parents and guardians never see or need these codes; they sign in separately with their child's ID and surname.</p>
      </div>
    </div>
  `);
}

/* ============================= Modals ============================= */
function renderModal(){
  const m = window._modal;
  if(!m) { document.getElementById('modal-root').innerHTML=''; return; }
  const root = document.getElementById('modal-root');

  if(m.type==='student'){
    const editing = m.data;
    root.innerHTML = `
    <div class="modal-overlay" data-overlay-close="1">
      <div class="modal">
        <div class="modal-head"><h3>${editing?'Edit student':'Add student'}</h3><button class="modal-close" data-action="close-modal">&times;</button></div>
        <div class="modal-body">
          <div class="field"><label>Full name</label><input id="f-name" value="${esc(editing?editing.name:'')}"></div>
          <div class="field-row">
            <div class="field"><label>Student ID / LRN</label><input id="f-lrn" value="${esc(editing?editing.lrn||'':'')}"></div>
            <div class="field"><label>Section</label>
              ${S.sections.length ? `<select id="f-section">
                ${S.sections.map(sec=>`<option value="${sec.id}" ${editing&&editing.sectionId===sec.id?'selected':''}>${esc(sec.name)}</option>`).join('')}
              </select>` : `<div class="small" style="color:var(--absent);">No sections yet — <button type="button" class="btn btn-ghost btn-sm" style="padding:3px 9px;" data-action="open-section-modal-from-student">add one first</button></div>`}
            </div>
          </div>
          <div class="field-row">
            <div class="field"><label>Guardian name</label><input id="f-guardian" value="${esc(editing?editing.guardianName||'':'')}"></div>
            <div class="field"><label>Guardian contact</label><input id="f-contact" value="${esc(editing?editing.guardianContact||'':'')}"></div>
          </div>
          ${editing?`<div class="field"><label>Status</label>
            <select id="f-status">
              <option value="active" ${editing.status!=='inactive'?'selected':''}>Active</option>
              <option value="inactive" ${editing.status==='inactive'?'selected':''}>Inactive</option>
            </select></div>`:''}
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" data-action="close-modal">Cancel</button>
          <button class="btn btn-gold" data-action="submit-student" data-id="${editing?editing.id:''}">${editing?'Save changes':'Add student'}</button>
        </div>
      </div>
    </div>`;
  } else if(m.type==='section'){
    const editing = m.data;
    root.innerHTML = `
    <div class="modal-overlay" data-overlay-close="1">
      <div class="modal">
        <div class="modal-head"><h3>${editing?'Edit section':'Add section'}</h3><button class="modal-close" data-action="close-modal">&times;</button></div>
        <div class="modal-body">
          <div class="field"><label>Section name</label><input id="f-sname" value="${esc(editing?editing.name:'')}" placeholder="e.g. Grade 7 — Al-Ghazali"></div>
          <div class="field-row">
            <div class="field"><label>Grade level</label><input id="f-grade" value="${esc(editing?editing.gradeLevel||'':'')}" placeholder="e.g. Grade 7"></div>
            <div class="field"><label>Adviser</label><input id="f-adviser" value="${esc(editing?editing.adviser||'':'')}"></div>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" data-action="close-modal">Cancel</button>
          <button class="btn btn-gold" data-action="submit-section" data-id="${editing?editing.id:''}">${editing?'Save changes':'Add section'}</button>
        </div>
      </div>
    </div>`;
  } else if(m.type==='import'){
    root.innerHTML = renderImportModal();
  }
}

function renderImportModal(){
  if(S.importRunning){
    return `<div class="modal-overlay" data-overlay-close="1"><div class="modal" style="max-width:520px;">
      <div class="modal-head"><h3>Importing roster…</h3></div>
      <div class="modal-body">
        <p class="muted">Adding student ${S.importProgress.done} of ${S.importProgress.total}. Keep this tab open.</p>
      </div>
    </div></div>`;
  }
  if(S.importResult){
    const r = S.importResult;
    return `<div class="modal-overlay" data-overlay-close="1"><div class="modal" style="max-width:520px;">
      <div class="modal-head"><h3>Import complete</h3><button class="modal-close" data-action="close-modal">&times;</button></div>
      <div class="modal-body">
        <p><b>${r.added}</b> student${r.added===1?'':'s'} added.${r.sectionsCreated.length? ' Created ' +r.sectionsCreated.length+ ' new section'+(r.sectionsCreated.length===1?'':'s')+ ': '+r.sectionsCreated.map(esc).join(', ')+'.' : ''}</p>
        ${r.skipped.length ? `<p class="muted small">Skipped ${r.skipped.length} row(s) with no name: line ${r.skipped.join(', ')}.</p>` : ''}
      </div>
      <div class="modal-foot"><button class="btn btn-gold" data-action="close-modal">Done</button></div>
    </div></div>`;
  }
  if(!S.importRows){
    return `<div class="modal-overlay" data-overlay-close="1"><div class="modal" style="max-width:560px;">
      <div class="modal-head"><h3>Import roster</h3><button class="modal-close" data-action="close-modal">&times;</button></div>
      <div class="modal-body">
        <p class="small muted" style="margin-top:0;">Paste a spreadsheet export (CSV, or copied straight from Excel/Sheets), or choose a .csv file. First row must be a header. Recognised columns: <b>Name</b> (required), ID/LRN, Section, Guardian Name, Guardian Contact — any order.</p>
        <div class="field">
          <label>Choose a CSV file</label>
          <input type="file" id="import-file" accept=".csv,text/csv,text/plain">
        </div>
        <div class="field">
          <label>…or paste rows here</label>
          <textarea id="import-text" rows="7" placeholder="Name,ID/LRN,Section,Guardian Name,Guardian Contact
Erinfolami AbdulShakur,MIA-001,Grade 1 - Aqidah,Erinfolami Adam,08084929862">${esc(S.importText)}</textarea>
        </div>
        <button class="btn btn-ghost btn-sm" data-action="download-import-template">Download a blank template</button>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-action="close-modal">Cancel</button>
        <button class="btn btn-gold" data-action="parse-import">Preview</button>
      </div>
    </div></div>`;
  }
  const rows = S.importRows;
  const ok = rows.filter(r=>!r.errors.length);
  const bad = rows.filter(r=>r.errors.length);
  return `<div class="modal-overlay" data-overlay-close="1"><div class="modal" style="max-width:720px;">
    <div class="modal-head"><h3>Review ${rows.length} row${rows.length===1?'':'s'}</h3><button class="modal-close" data-action="close-modal">&times;</button></div>
    <div class="modal-body">
      <p class="small muted" style="margin-top:0;">${ok.length} will be imported${bad.length?', '+bad.length+' skipped (no name)':''}. New section names not already in your list will be created automatically.</p>
      <div class="tbl-wrap" style="max-height:320px;overflow-y:auto;border:1px solid var(--line);border-radius:8px;">
        <table>
          <thead><tr><th>Name</th><th>ID/LRN</th><th>Section</th><th>Guardian</th><th>Status</th></tr></thead>
          <tbody>
            ${rows.map(r=>`<tr>
              <td>${esc(r.name)||'<span class="muted">—</span>'}</td>
              <td class="muted">${esc(r.lrn)}</td>
              <td class="muted">${esc(r.section)}</td>
              <td class="muted">${esc(r.guardianName)}${r.guardianContact?' · '+esc(r.guardianContact):''}</td>
              <td>${r.errors.length ? `<span class="badge absent">${esc(r.errors.join(', '))}</span>` : `<span class="badge present">OK</span>`}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" data-action="import-back">Back</button>
      <button class="btn btn-gold" data-action="confirm-import" ${ok.length?'':'disabled'}>Import ${ok.length} student${ok.length===1?'':'s'}</button>
    </div>
  </div></div>`;
}

/* ============================= Sign-in gate ============================= */
function renderGate(){
  const mode = S.gateMode || 'staff';
  const roles = [['admin','Administrator'],['teacher','Teacher / Staff']];
  const pendingRole = window._pendingRole || null;

  const staffForm = `
      <div class="field"><label>Your role</label>
        <div class="role-grid" style="grid-template-columns:1fr 1fr;">
          ${roles.map(([id,label])=>`<div class="role-opt ${pendingRole===id?'active':''}" data-action="pick-role" data-role="${id}">${label}</div>`).join('')}
        </div>
      </div>
      <div class="field"><label>Your name</label><input id="gate-name" placeholder="e.g. Ustadha Amina Reyes" value="${esc(window._pendingName||'')}"></div>
      <div class="field"><label>Access code</label><input id="gate-code" type="password" placeholder="Provided by the academy office" autocomplete="off"></div>
      <button class="btn btn-primary" data-action="enter-portal" ${pendingRole?'':'disabled'}>Enter portal</button>
      <p class="small muted" style="text-align:center;margin-top:16px;">For administrators and teaching staff. Ask the school office for your access code.</p>`;

  const parentForm = `
      <div class="field"><label>Child's Student ID / LRN</label><input id="parent-lrn" placeholder="e.g. MIA-001"></div>
      <div class="field"><label>Child's surname</label><input id="parent-surname" placeholder="e.g. AbdulShakur"></div>
      ${S.parentError ? `<p class="small" style="color:var(--absent);margin:-6px 0 14px;">${esc(S.parentError)}</p>` : ''}
      <button class="btn btn-primary" data-action="parent-login">Find my child's attendance</button>
      <p class="small muted" style="text-align:center;margin-top:16px;">You'll only see your own child's attendance record — nothing can be marked or edited from here.</p>`;

  return `
  <div class="gate">
    <div class="gate-card">
      <div class="gate-crest"><img src="${LOGO_SRC}" alt="Academy crest"></div>
      <div class="gate-title">Maknazul 'Irfan Academy</div>
      <div class="gate-sub">Student Attendance Portal</div>
      <div class="role-grid" style="grid-template-columns:1fr 1fr;margin-bottom:22px;">
        <div class="role-opt ${mode==='staff'?'active':''}" data-action="set-gate-mode" data-mode="staff">Administrator / Teacher</div>
        <div class="role-opt ${mode==='parent'?'active':''}" data-action="set-gate-mode" data-mode="parent">Parent / Guardian</div>
      </div>
      ${mode==='staff' ? staffForm : parentForm}
    </div>
  </div>`;
}

/* ============================= Render: Parent dashboard ============================= */
function renderParentDashboard(){
  const d = S.parentData;
  if(S.parentLoading || !d){
    return renderParentShell(`<div class="empty">Loading your child's attendance…</div>`);
  }
  const st = d.student;
  const rate = d.rate===null ? '—' : d.rate+'%';
  return renderParentShell(`
    <div class="panel">
      <div class="panel-body" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:14px;">
        <div>
          <h1 style="margin:0 0 4px;font-size:1.3rem;color:var(--green-900);">${esc(st.name)}</h1>
          <p class="small muted" style="margin:0;">${esc(st.lrn||'No ID on file')} · ${esc(sectionName(st.sectionId))}</p>
        </div>
        <span class="badge ${d.rate!==null && d.rate<S.attendanceThreshold ? 'flag':'present'}" style="font-size:.9rem;padding:6px 14px;">${rate} attendance</span>
      </div>
    </div>

    <div class="stat-row">
      <div class="stat-card present"><div class="n">${d.counts.present}</div><div class="l">Present</div></div>
      <div class="stat-card late"><div class="n">${d.counts.late}</div><div class="l">Late</div></div>
      <div class="stat-card absent"><div class="n">${d.counts.absent}</div><div class="l">Absent</div></div>
      <div class="stat-card excused"><div class="n">${d.counts.excused}</div><div class="l">Excused</div></div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Attendance history</h2><span class="small muted">Last 120 days</span></div>
      <div class="tbl-wrap">
        ${d.rows.length ? `<table>
          <thead><tr><th>Date</th><th>Status</th><th>Note</th></tr></thead>
          <tbody>
            ${d.rows.map(r=>`<tr>
              <td>${fmtDate(r.date)}</td>
              <td><span class="badge ${r.status}">${r.status.charAt(0).toUpperCase()+r.status.slice(1)}</span></td>
              <td class="muted">${esc(r.note||'—')}</td>
            </tr>`).join('')}
          </tbody>
        </table>` : `<div class="empty">No attendance has been recorded yet for this date range.</div>`}
      </div>
    </div>
  `);
}

/* ============================= Main render ============================= */
function render(){
  const app = document.getElementById('app');
  if(!S.role){
    app.innerHTML = renderGate();
  } else if(S.role==='parent'){
    app.innerHTML = renderParentDashboard();
  } else {
    let html;
    const allowedViews = navForRole(S.role).map(n=>n.id);
    if(!allowedViews.includes(S.view)) S.view = allowedViews[0] || 'dashboard';
    if(S.view==='dashboard') html = renderDashboard();
    else if(S.view==='attendance') html = renderAttendance();
    else if(S.view==='students') html = renderStudents();
    else if(S.view==='sections') html = renderSections();
    else if(S.view==='reports') html = renderReports();
    else if(S.view==='notes') html = renderNotes();
    else if(S.view==='settings') html = renderSettings();
    else html = renderDashboard();
    app.innerHTML = html;
    if(S.view==='dashboard' && S.dashboard.trend) drawTrendChart();
  }
  renderModal();
}

function drawTrendChart(){
  const canvas = document.getElementById('trend-canvas');
  if(!canvas || typeof Chart==='undefined') return;
  const trend = S.dashboard.trend || [];
  if(trendChart) trendChart.destroy();
  const styles = getComputedStyle(document.documentElement);
  const green = styles.getPropertyValue('--green-800').trim() || '#154834';
  const gold = styles.getPropertyValue('--gold-500').trim() || '#C9982F';
  const ink = styles.getPropertyValue('--ink-soft').trim() || '#5B6960';
  trendChart = new Chart(canvas.getContext('2d'), {
    type:'line',
    data:{
      labels: trend.map(t=>fmtDateShort(t.date)),
      datasets:[{
        label:'Attendance rate',
        data: trend.map(t=>t.rate),
        borderColor: green,
        backgroundColor: gold,
        pointBackgroundColor: gold,
        tension:.3,
        spanGaps:true,
      }]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{legend:{display:false}},
      scales:{
        y:{min:0,max:100,ticks:{color:ink,callback:v=>v+'%'},grid:{color:'rgba(128,128,128,.12)'}},
        x:{ticks:{color:ink},grid:{display:false}}
      }
    }
  });
}

/* ============================= Event delegation ============================= */
document.addEventListener('click', async (e)=>{
  if(e.target && e.target.dataset && e.target.dataset.overlayClose){
    window._modal = null; renderModal(); return;
  }
  const el = e.target.closest('[data-action]');
  if(!el) return;
  const action = el.dataset.action;

  if(action==='set-gate-mode'){ S.gateMode = el.dataset.mode; window._pendingRole = null; S.parentError=''; render(); }
  else if(action==='pick-role'){ window._pendingRole = el.dataset.role; render(); }
  else if(action==='enter-portal'){
    const nameEl = document.getElementById('gate-name');
    const codeEl = document.getElementById('gate-code');
    const code = (codeEl && codeEl.value.trim()) || '';
    const role = window._pendingRole;
    await fetchAccessCodes();
    const expected = role==='admin' ? accessCodes.adminCode : accessCodes.staffCode;
    if(code !== expected){ toast('Incorrect access code for that role.'); return; }
    S.staffName = (nameEl && nameEl.value.trim()) || 'Staff';
    S.role = role;
    S.view = role==='teacher' ? 'attendance' : 'dashboard';
    saveLocal();
    render();
    loadAttendanceForSelection(); loadDashboard();
  }
  else if(action==='parent-login'){
    const lrnEl = document.getElementById('parent-lrn');
    const surnameEl = document.getElementById('parent-surname');
    const lrn = (lrnEl && lrnEl.value.trim().toLowerCase()) || '';
    const surname = (surnameEl && surnameEl.value.trim().toLowerCase()) || '';
    if(!lrn || !surname){ S.parentError = 'Please enter both the student ID and surname.'; render(); return; }
    const match = S.students.find(s=>{
      if((s.lrn||'').trim().toLowerCase() !== lrn) return false;
      const words = (s.name||'').trim().toLowerCase().split(/\s+/).filter(Boolean);
      return words.includes(surname);
    });
    if(!match){
      S.parentError = "We couldn't find a student with that ID and surname. Please check with the school office.";
      render();
      return;
    }
    S.parentError = '';
    S.role = 'parent';
    S.parentStudentId = match.id;
    S.staffName = 'Parent/Guardian of '+match.name;
    saveLocal();
    render();
    loadParentAttendance(match.id);
  }
  else if(action==='signout'){
    S.role = null; window._pendingRole = null; S.parentStudentId = null; S.parentData = null; S.parentError='';
    saveLocal(); render();
  }
  else if(action==='nav'){
    S.view = el.dataset.view; S.sidebarOpen=false; render();
    if(S.view==='attendance') loadAttendanceForSelection();
    if(S.view==='dashboard') loadDashboard();
    if(S.view==='reports' && !S.reportRows.length) loadReport();
  }
  else if(action==='open-sidebar'){ S.sidebarOpen=true; render(); }
  else if(action==='close-sidebar'){ S.sidebarOpen=false; render(); }
  else if(action==='refresh-dashboard'){ loadDashboard(); }
  else if(action==='goto-attendance'){ S.selectedSectionId = el.dataset.id; S.view='attendance'; render(); loadAttendanceForSelection(); }
  else if(action==='goto-notes'){ S.notesStudentId = el.dataset.id; S.view='notes'; render(); loadNotes(el.dataset.id); }
  else if(action==='mark-all'){ markAll(el.dataset.status); }
  else if(action==='set-status'){ setStatus(el.dataset.id, el.dataset.status); }
  else if(action==='save-attendance'){ saveAttendance(); }
  else if(action==='run-report'){ loadReport(); }
  else if(action==='export-report'){ exportReportCsv(); }
  else if(action==='export-report-pdf'){ exportReportPdf(); }
  else if(action==='open-student-modal'){ window._modal={type:'student', data:null}; renderModal(); }
  else if(action==='edit-student'){ window._modal={type:'student', data:S.students.find(s=>s.id===el.dataset.id)}; renderModal(); }
  else if(action==='delete-student'){
    if(confirm('Remove this student from the roster?')){
      try{ await deleteStudent(el.dataset.id); toast('Student removed.'); }
      catch(err){ console.error(err); toast('Could not remove the student.'); }
    }
  }
  else if(action==='open-section-modal'){ window._modal={type:'section', data:null}; renderModal(); }
  else if(action==='edit-section'){ window._modal={type:'section', data:S.sections.find(s=>s.id===el.dataset.id)}; renderModal(); }
  else if(action==='delete-section'){
    if(confirm('Remove this section? Students keep their record but lose their section link.')){
      try{ await deleteSection(el.dataset.id); toast('Section removed.'); }
      catch(err){ console.error(err); toast('Could not remove the section.'); }
    }
  }
  else if(action==='close-modal'){
    window._modal=null;
    S.importText=''; S.importRows=null; S.importResult=null; S.importRunning=false;
    renderModal();
  }
  else if(action==='open-import-modal'){
    if(S.role!=='admin') return;
    S.importText=''; S.importRows=null; S.importResult=null;
    window._modal={type:'import'};
    renderModal();
  }
  else if(action==='import-back'){ S.importRows=null; renderModal(); }
  else if(action==='download-import-template'){
    const csv = 'Name,ID/LRN,Section,Guardian Name,Guardian Contact\nErinfolami AbdulShakur,MIA-001,Grade 1 - Aqidah,Erinfolami Adam,08084929862\n';
    downloadTextFile('roster-template.csv', csv, 'text/csv');
  }
  else if(action==='parse-import'){
    const fileInput = document.getElementById('import-file');
    const textArea = document.getElementById('import-text');
    const pasted = textArea ? textArea.value : '';
    const finish = (text)=>{
      const {rows, error} = parseRoster(text);
      if(error){ toast(error); return; }
      if(!rows.length){ toast('No data rows found.'); return; }
      S.importRows = rows;
      renderModal();
    };
    if(fileInput && fileInput.files && fileInput.files[0]){
      const reader = new FileReader();
      reader.onload = ()=> finish(String(reader.result||''));
      reader.onerror = ()=> toast('Could not read that file.');
      reader.readAsText(fileInput.files[0]);
    } else if(pasted.trim()){
      finish(pasted);
    } else {
      toast('Choose a CSV file or paste some rows first.');
    }
  }
  else if(action==='confirm-import'){
    const rows = (S.importRows||[]).filter(r=>!r.errors.length);
    const skipped = (S.importRows||[]).filter(r=>r.errors.length).map(r=>r.line);
    S.importRunning = true;
    S.importProgress = {done:0, total:rows.length};
    renderModal();
    const sectionMap = {};
    S.sections.forEach(sec=>{ sectionMap[sec.name.trim().toLowerCase()] = sec.id; });
    const sectionsCreated = [];
    let added = 0;
    for(const row of rows){
      try{
        let sectionId = '';
        const sText = (row.section||'').trim();
        if(sText){
          const key = sText.toLowerCase();
          if(sectionMap[key]) sectionId = sectionMap[key];
          else{
            const newId = await addSection({name:sText, gradeLevel:'', adviser:''});
            if(newId){ sectionMap[key] = newId; sectionId = newId; sectionsCreated.push(sText); }
          }
        }
        await addStudent({
          name: row.name, lrn: row.lrn, sectionId,
          guardianName: row.guardianName, guardianContact: row.guardianContact,
        });
        added++;
      }catch(err){ console.error('import row failed', row, err); }
      S.importProgress = {done: S.importProgress.done+1, total: rows.length};
      renderModal();
    }
    S.importRunning = false;
    S.importResult = {added, sectionsCreated, skipped};
    renderModal();
  }
  else if(action==='open-section-modal-from-student'){
    window._pendingStudentDraft = {
      name: document.getElementById('f-name').value,
      lrn: document.getElementById('f-lrn').value,
      guardianName: document.getElementById('f-guardian').value,
      guardianContact: document.getElementById('f-contact').value,
    };
    window._modal={type:'section', data:null, returnToStudent:true};
    renderModal();
  }
  else if(action==='submit-student'){
    const name = document.getElementById('f-name').value.trim();
    if(!name){ toast('Please enter a name.'); return; }
    const sectionEl = document.getElementById('f-section');
    if(!sectionEl){ toast('Add a section first, then add the student.'); return; }
    const data = {
      name,
      lrn: document.getElementById('f-lrn').value.trim(),
      sectionId: sectionEl.value,
      guardianName: document.getElementById('f-guardian').value.trim(),
      guardianContact: document.getElementById('f-contact').value.trim(),
    };
    const statusEl = document.getElementById('f-status');
    if(statusEl) data.status = statusEl.value;
    el.disabled = true; el.textContent = 'Saving…';
    try{
      if(el.dataset.id){ await updateStudent(el.dataset.id, data); toast('Student updated.'); }
      else { await addStudent(data); toast('Student added.'); }
      window._modal=null; renderModal();
    }catch(err){
      console.error(err);
      toast('Could not save the student: '+(err && err.message ? err.message : 'please try again.'));
      el.disabled = false; el.textContent = el.dataset.id ? 'Save changes' : 'Add student';
    }
  }
  else if(action==='submit-section'){
    const name = document.getElementById('f-sname').value.trim();
    if(!name){ toast('Please enter a section name.'); return; }
    const data = {
      name,
      gradeLevel: document.getElementById('f-grade').value.trim(),
      adviser: document.getElementById('f-adviser').value.trim(),
    };
    el.disabled = true; el.textContent = 'Saving…';
    try{
      const wasReturnToStudent = window._modal && window._modal.returnToStudent;
      if(el.dataset.id){ await updateSection(el.dataset.id, data); toast('Section updated.'); }
      else { await addSection(data); }
      if(wasReturnToStudent){
        window._modal = {type:'student', data: window._pendingStudentDraft || null};
        window._pendingStudentDraft = null;
        toast('Section added — continue adding the student.');
      } else {
        window._modal=null;
        toast('Section added.');
      }
      renderModal();
    }catch(err){
      console.error(err);
      toast('Could not save the section: '+(err && err.message ? err.message : 'please try again.'));
      el.disabled = false; el.textContent = el.dataset.id ? 'Save changes' : 'Add section';
    }
  }
  else if(action==='save-access-codes'){
    if(S.role!=='admin') return;
    const adminCode = document.getElementById('cfg-admin-code').value.trim();
    const staffCode = document.getElementById('cfg-staff-code').value.trim();
    if(!adminCode || !staffCode){ toast('Both codes are required.'); return; }
    el.disabled = true; el.textContent = 'Saving…';
    try{
      const {error} = await sb.from('config').upsert({
        key:'access',
        value:{ adminCode, staffCode, updatedBy: S.staffName || 'Admin', updatedAt: new Date().toISOString() },
      });
      if(error) throw error;
      accessCodes = { adminCode, staffCode };
      toast('Access codes updated.');
    }catch(err){
      console.error(err);
      toast('Could not save the codes: '+(err && err.message ? err.message : 'please try again.'));
    }
    el.disabled = false; el.textContent = 'Save codes';
  }
  else if(action==='add-note'){
    const txt = document.getElementById('note-text').value;
    await addNote(el.dataset.id, txt);
    document.getElementById('note-text').value='';
  }
});

document.addEventListener('change', (e)=>{
  const el = e.target.closest('[data-action]');
  if(!el) return;
  const action = el.dataset.action;
  if(action==='select-section'){ S.selectedSectionId = el.value; loadAttendanceForSelection(); }
  else if(action==='select-date'){ S.selectedDate = el.value; loadAttendanceForSelection(); }
  else if(action==='report-from'){ S.reportFrom = el.value; }
  else if(action==='report-to'){ S.reportTo = el.value; }
  else if(action==='report-section'){ S.reportSectionId = el.value; }
  else if(action==='notes-select-student'){ S.notesStudentId = el.value || null; render(); if(el.value) loadNotes(el.value); }
});

document.addEventListener('input', (e)=>{
  const el = e.target.closest('[data-action]');
  if(!el) return;
  const action = el.dataset.action;
  if(action==='search-students'){ S.studentSearch = el.value; render(); document.querySelector('.search-input').focus(); document.querySelector('.search-input').selectionStart = document.querySelector('.search-input').value.length; }
  else if(action==='set-note'){ setNote(el.dataset.id, el.value); }
});

/* ============================= Boot ============================= */
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{ navigator.serviceWorker.register('./service-worker.js').catch(console.error); });
}
loadLocal();
render();
initApp();
