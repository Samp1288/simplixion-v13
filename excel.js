const encoder = new TextEncoder();
const decoder = new TextDecoder();

function xmlEscape(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&apos;", '"': "&quot;" }[char]));
}

function columnName(index) {
  let name = "";
  let value = index + 1;
  while (value) { const remainder = (value - 1) % 26; name = String.fromCharCode(65 + remainder) + name; value = Math.floor((value - 1) / 26); }
  return name;
}

function cellXml(value, reference) {
  if (value === null || value === undefined || value === "") return `<c r="${reference}"/>`;
  if (typeof value === "number" && Number.isFinite(value)) return `<c r="${reference}"><v>${value}</v></c>`;
  if (typeof value === "boolean") return `<c r="${reference}" t="b"><v>${value ? 1 : 0}</v></c>`;
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

function worksheetXml(rows) {
  const body = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => cellXml(value, `${columnName(columnIndex)}${rowIndex + 1}`)).join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

function u16(value) { return [value & 255, (value >>> 8) & 255]; }
function u32(value) { return [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]; }
function concatBytes(parts) { const length = parts.reduce((total, part) => total + part.length, 0); const result = new Uint8Array(length); let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; } return result; }
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = typeof content === "string" ? encoder.encode(content) : content;
    const crc = crc32(data);
    const local = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04, ...u16(20), ...u16(0x800), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0)
    ]);
    locals.push(concatBytes([local, nameBytes, data]));
    const central = new Uint8Array([
      0x50, 0x4b, 0x01, 0x02, ...u16(20), ...u16(20), ...u16(0x800), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)
    ]);
    centrals.push(concatBytes([central, nameBytes]));
    offset += local.length + nameBytes.length + data.length;
  }
  const centralBytes = concatBytes(centrals);
  const localBytes = concatBytes(locals);
  const end = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...u16(0), ...u16(0), ...u16(files ? Object.keys(files).length : 0), ...u16(files ? Object.keys(files).length : 0), ...u32(centralBytes.length), ...u32(localBytes.length), ...u16(0)]);
  return concatBytes([localBytes, centralBytes, end]);
}

function workbookFiles(data) {
  const sheets = [
    ["Projects", [["ID", "Name", "Client", "Status", "Start date", "End date", "Primary estimate ID", "Notes"], ...(data.projects || []).map((row) => [row.id, row.name, row.client, row.status, row.startDate, row.endDate, row.primaryEstimateId, row.notes])]],
    ["Transactions", [["ID", "Project ID", "Date", "Type", "Category", "Description", "Status", "Amount CAD", "Net amount", "Tax code", "Tax included", "Tax amount", "GST", "QST", "HST", "Counterparty", "Reference", "Payment method", "Deductible", "Reconciled", "Notes"], ...(data.transactions || []).map((row) => [row.id, row.projectId, row.date, row.type, row.category, row.description, row.status, Number(row.amount) || 0, Number(row.netAmount) || 0, row.taxCode, row.taxIncluded !== false, Number(row.taxAmount) || 0, Number(row.gstAmount) || 0, Number(row.qstAmount) || 0, Number(row.hstAmount) || 0, row.counterparty, row.reference, row.paymentMethod, row.deductible !== false, row.reconciled === true, row.notes])]],
    ["Budgets", [["ID", "Project ID", "Category", "Start date", "Frequency", "Amount CAD"], ...(data.budgets || []).map((row) => [row.id, row.projectId, row.category, row.startDate, row.frequency, Number(row.amount) || 0])]],
    ["Recurring", [["ID", "Project ID", "Type", "Category", "Description", "Start date", "Frequency", "Day", "Active", "Amount CAD", "Tax code", "Tax included", "Payment method", "Counterparty", "Deductible"], ...(data.recurring || []).map((row) => [row.id, row.projectId, row.type, row.category, row.description, row.startDate, row.frequency, Number(row.day) || 1, row.active !== false, Number(row.amount) || 0, row.taxCode, row.taxIncluded !== false, row.paymentMethod, row.counterparty, row.deductible !== false])]],
    ["Estimates", [["ID", "Project ID", "Number", "Title", "Client", "Status", "Issue date", "Event date", "Template ID", "Notes", "Payment terms", "Tax code", "Subtotal", "Tax rate", "Tax", "GST", "QST", "HST", "Total"], ...(data.estimates || []).map((row) => [row.id, row.projectId, row.number, row.title, row.client, row.status, row.issueDate, row.eventDate || row.validUntil, row.templateId, row.notes, row.paymentTerms, row.taxCode, Number(row.subtotal) || 0, Number(row.taxRate) || 0, Number(row.tax) || 0, Number(row.gstAmount) || 0, Number(row.qstAmount) || 0, Number(row.hstAmount) || 0, Number(row.total) || 0])]],
    ["EstimateItems", [["ID", "Estimate ID", "Description", "Quantity", "Unit price", "Total"], ...(data.estimateItems || []).map((row) => [row.id, row.estimateId, row.description, Number(row.quantity) || 0, Number(row.unitPrice) || 0, Number(row.total) || 0])]],
    ["EstimatePayments", [["ID", "Estimate ID", "Label", "Percentage", "Amount", "Due date", "Status", "Paid date"], ...(data.paymentSchedule || []).map((row) => [row.id, row.estimateId, row.label, Number(row.percentage) || 0, Number(row.amount) || 0, row.dueDate, row.status, row.paidDate])]],
    ["Accounting", [["Year", "Revenue before taxes", "Deductible expenses", "Accounting result", "Taxes collected", "Taxes paid", "Tax balance"], ...(data.accountingRows || [])]],
    ["Company", [["Field", "Value"], ["Trade name", data.settings?.company?.tradeName || ""], ["Legal name", data.settings?.company?.legalName || ""], ["Business number", data.settings?.company?.businessNumber || ""], ["Province", data.settings?.company?.province || ""], ["Email", data.settings?.company?.email || ""], ["Phone", data.settings?.company?.phone || ""], ["Address", data.settings?.company?.address || ""], ["Website", data.settings?.company?.website || ""], ["Brand primary", data.settings?.branding?.primary || ""], ["Brand accent", data.settings?.branding?.accent || ""], ["Brand footer", data.settings?.branding?.footer || ""], ["Default template ID", data.settings?.branding?.defaultTemplateId || ""]]],
    ["EstimateTemplates", [["ID", "Name", "Layout", "Primary", "Accent", "Show logo", "Show payment schedule", "Footer", "Built in"], ...(data.settings?.branding?.templates || []).map((row) => [row.id, row.name, row.layout, row.primary, row.accent, row.showLogo !== false, row.showPaymentSchedule !== false, row.footer, row.builtin === true])]]
  ];
  const overrides = sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
  const rels = sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("");
  const sheetLinks = sheets.map(([name], index) => `<sheet name="${xmlEscape(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${overrides}</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetLinks}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`,
    "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Aptos"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellXfs></styleSheet>`,
    "docProps/core.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Simplixion</dc:title><dc:creator>Simplixion</dc:creator><cp:lastModifiedBy>Simplixion</cp:lastModifiedBy></cp:coreProperties>`,
    "docProps/app.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Simplixion</Application></Properties>`
  };
  sheets.forEach(([name, rows], index) => { files[`xl/worksheets/sheet${index + 1}.xml`] = worksheetXml(rows); });
  return files;
}

export function exportWorkbook(data) {
  return new Blob([zipStore(workbookFiles(data))], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function readU16(bytes, offset) { return bytes[offset] | bytes[offset + 1] << 8; }
function readU32(bytes, offset) { return (bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16 | bytes[offset + 3] << 24) >>> 0; }
function findEndOfCentralDirectory(bytes) { for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65557); index--) if (readU32(bytes, index) === 0x06054b50) return index; throw Error("Classeur Excel invalide."); }
async function inflate(bytes) { if (!("DecompressionStream" in globalThis)) throw Error("Ce navigateur ne peut pas décompresser ce fichier Excel."); const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")); return new Uint8Array(await new Response(stream).arrayBuffer()); }

async function unzip(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (readU32(bytes, 0) !== 0x04034b50) throw Error("Le fichier doit être un classeur .xlsx.");
  const end = findEndOfCentralDirectory(bytes); const count = readU16(bytes, end + 10); const directoryOffset = readU32(bytes, end + 16); const entries = {};
  let cursor = directoryOffset;
  for (let index = 0; index < count; index++) {
    if (readU32(bytes, cursor) !== 0x02014b50) throw Error("Structure Excel invalide.");
    const method = readU16(bytes, cursor + 10); const compressedSize = readU32(bytes, cursor + 20); const nameLength = readU16(bytes, cursor + 28); const extraLength = readU16(bytes, cursor + 30); const commentLength = readU16(bytes, cursor + 32); const localOffset = readU32(bytes, cursor + 42); const name = decoder.decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));
    const localNameLength = readU16(bytes, localOffset + 26); const localExtraLength = readU16(bytes, localOffset + 28); const start = localOffset + 30 + localNameLength + localExtraLength; const compressed = bytes.slice(start, start + compressedSize); entries[name] = method === 0 ? compressed : method === 8 ? await inflate(compressed) : (() => { throw Error("Compression Excel non prise en charge."); })(); cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function parseXml(text) { return new DOMParser().parseFromString(text, "application/xml"); }
function xmlText(node) { return node?.textContent?.trim() || ""; }
function columnIndex(reference) { const letters = String(reference).match(/^[A-Z]+/i)?.[0].toUpperCase() || "A"; let result = 0; for (const letter of letters) result = result * 26 + letter.charCodeAt(0) - 64; return result - 1; }
function parseSharedStrings(xml) { const document = parseXml(xml); return [...document.getElementsByTagNameNS("*", "si")].map((item) => [...item.getElementsByTagNameNS("*", "t")].map((node) => node.textContent || "").join("")); }
function parseSheet(xml, sharedStrings) {
  const document = parseXml(xml); const rows = [];
  for (const row of [...document.getElementsByTagNameNS("*", "row")]) {
    const values = []; for (const cell of [...row.getElementsByTagNameNS("*", "c")]) { const index = columnIndex(cell.getAttribute("r")); const type = cell.getAttribute("t"); let value = ""; if (type === "inlineStr") value = xmlText(cell.getElementsByTagNameNS("*", "t")[0]); else { const raw = xmlText(cell.getElementsByTagNameNS("*", "v")[0]); value = type === "s" ? (sharedStrings[Number(raw)] || "") : type === "b" ? raw === "1" : raw === "" ? "" : Number.isNaN(Number(raw)) ? raw : Number(raw); } values[index] = value; } rows.push(values.map((value) => value ?? ""));
  }
  return rows;
}
function normalizeHeader(value) { return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
function records(rows) { if (!rows?.length) return []; const headers = rows[0].map(normalizeHeader); return rows.slice(1).filter((row) => row.some((value) => String(value ?? "").trim() !== "")).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]))); }
function field(row, names, fallback = "") { for (const name of names) { const value = row[normalizeHeader(name)]; if (value !== undefined && value !== "") return value; } return fallback; }
function sheetByName(sheets, names) { const wanted = names.map(normalizeHeader); return Object.entries(sheets).find(([name]) => wanted.includes(normalizeHeader(name)))?.[1] || []; }
function toDate(value) { if (typeof value === "number") { const date = new Date(Date.UTC(1899, 11, 30 + value)); return date.toISOString().slice(0, 10); } const text = String(value || "").trim(); if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text; const date = new Date(text); return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10); }
function toNumber(value) { const number = Number(String(value ?? "").replace(/\s/g, "").replace(",", ".")); return Number.isFinite(number) ? number : 0; }

export async function importWorkbook(file) {
  const entries = await unzip(file); const workbook = parseXml(decoder.decode(entries["xl/workbook.xml"])); const relationships = parseXml(decoder.decode(entries["xl/_rels/workbook.xml.rels"])); const targets = Object.fromEntries([...relationships.getElementsByTagNameNS("*", "Relationship")].map((node) => [node.getAttribute("Id"), node.getAttribute("Target")])); const sharedStrings = entries["xl/sharedStrings.xml"] ? parseSharedStrings(decoder.decode(entries["xl/sharedStrings.xml"])) : []; const sheetNodes = [...workbook.getElementsByTagNameNS("*", "sheet")]; const sheets = {};
  for (const sheet of sheetNodes) { const target = targets[sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id")]; if (!target) continue; const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`; if (entries[path]) sheets[sheet.getAttribute("name")] = parseSheet(decoder.decode(entries[path]), sharedStrings); }
  const result = { projects: [], transactions: [], budgets: [], recurring: [], estimates: [], estimateItems: [], paymentSchedule: [], settings: {}, recognizedSheets: Object.keys(sheets) };
  const projectRows = records(sheetByName(sheets, ["Projects", "Projets"])); result.projects = projectRows.map((row) => ({ id: String(field(row, ["ID", "Project ID", "Projet ID"], "")), name: String(field(row, ["Name", "Project name", "Nom", "Nom du projet"])), client: String(field(row, ["Client", "Customer"])), status: String(field(row, ["Status", "Statut"], "active")), startDate: toDate(field(row, ["Start date", "Date de début"])), endDate: toDate(field(row, ["End date", "Date de fin"])), primaryEstimateId: String(field(row, ["Primary estimate ID", "Soumission principale"])), notes: String(field(row, ["Notes", "Description"])) })).filter((row) => row.name);
  const transactionRows = records(sheetByName(sheets, ["Transactions", "Transaction", "Mouvements"])); result.transactions = transactionRows.map((row) => ({ id: String(field(row, ["ID"])), projectId: String(field(row, ["Project ID", "Projet ID"])), date: toDate(field(row, ["Date"])), type: String(field(row, ["Type"], "expense")).toLowerCase().startsWith("in") || String(field(row, ["Type"], "")).toLowerCase().startsWith("rev") ? "income" : "expense", category: String(field(row, ["Category", "Catégorie"])), description: String(field(row, ["Description", "Title", "Nom"])), status: String(field(row, ["Status", "Statut"], "received")).toLowerCase().startsWith("plan") || String(field(row, ["Status", "Statut"], "")).toLowerCase().startsWith("prev") ? "planned" : "received", amount: toNumber(field(row, ["Amount CAD", "Amount", "Montant"])), netAmount: toNumber(field(row, ["Net amount", "Montant hors taxes"])), taxCode: String(field(row, ["Tax code", "Code de taxe"])), taxIncluded: !["false", "0", "non", "no"].includes(String(field(row, ["Tax included", "Taxes included"], true)).toLowerCase()), taxAmount: toNumber(field(row, ["Tax amount", "Tax", "Taxes"])), gstAmount: toNumber(field(row, ["GST", "TPS"])), qstAmount: toNumber(field(row, ["QST", "TVQ"])), hstAmount: toNumber(field(row, ["HST", "TVH"])), counterparty: String(field(row, ["Counterparty", "Client or vendor", "Fournisseur"])), reference: String(field(row, ["Reference", "Invoice / receipt no.", "No de facture / reçu"])), paymentMethod: String(field(row, ["Payment method", "Mode de paiement"])), deductible: !["false", "0", "non", "no"].includes(String(field(row, ["Deductible", "Déductible"], true)).toLowerCase()), reconciled: ["true", "1", "yes", "oui"].includes(String(field(row, ["Reconciled", "Rapprochée"], false)).toLowerCase()), notes: String(field(row, ["Notes"])) })).filter((row) => row.date && row.amount > 0);
  const budgetRows = records(sheetByName(sheets, ["Budgets", "Budget"])); result.budgets = budgetRows.map((row) => ({ id: String(field(row, ["ID"])), projectId: String(field(row, ["Project ID", "Projet ID"])), category: String(field(row, ["Category", "Catégorie"])), startDate: toDate(field(row, ["Start date", "Date de début"])), frequency: String(field(row, ["Frequency", "Fréquence"], "monthly")).toLowerCase(), amount: toNumber(field(row, ["Amount CAD", "Amount", "Montant"])) })).filter((row) => row.category && row.amount > 0);
  const recurringRows = records(sheetByName(sheets, ["Recurring", "Récurrences"])); result.recurring = recurringRows.map((row) => ({ id: String(field(row, ["ID"])), projectId: String(field(row, ["Project ID", "Projet ID"])), type: String(field(row, ["Type"], "expense")).toLowerCase().startsWith("in") || String(field(row, ["Type"], "")).toLowerCase().startsWith("rev") ? "income" : "expense", category: String(field(row, ["Category", "Catégorie"])), description: String(field(row, ["Description", "Nom"])), startDate: toDate(field(row, ["Start date", "Date de début"])), frequency: String(field(row, ["Frequency", "Fréquence"], "monthly")).toLowerCase(), day: toNumber(field(row, ["Day", "Jour"], 1)), active: !["false", "0", "non", "no"].includes(String(field(row, ["Active", "Actif"], true)).toLowerCase()), amount: toNumber(field(row, ["Amount CAD", "Amount", "Montant"])), taxCode: String(field(row, ["Tax code", "Code de taxe"])), taxIncluded: !["false", "0", "non", "no"].includes(String(field(row, ["Tax included", "Taxes included"], true)).toLowerCase()), paymentMethod: String(field(row, ["Payment method", "Mode de paiement"])), counterparty: String(field(row, ["Counterparty", "Client or vendor"])), deductible: !["false", "0", "non", "no"].includes(String(field(row, ["Deductible", "Déductible"], true)).toLowerCase()) })).filter((row) => row.category && row.amount > 0);
  const estimateRows = records(sheetByName(sheets, ["Estimates", "Soumissions", "Quotes"])); result.estimates = estimateRows.map((row) => ({ id: String(field(row, ["ID"])), projectId: String(field(row, ["Project ID", "Projet ID"])), number: String(field(row, ["Number", "Numéro"])), title: String(field(row, ["Title", "Titre", "Name", "Nom"])), client: String(field(row, ["Client", "Customer"])), status: String(field(row, ["Status", "Statut"], "draft")), issueDate: toDate(field(row, ["Issue date", "Date"])), eventDate: toDate(field(row, ["Event date", "Date de l’événement", "Date de l'evenement", "Valid until", "Valide jusqu’au", "Date de fin"])), templateId: String(field(row, ["Template ID", "Modèle de soumission"])), notes: String(field(row, ["Notes", "Description"])), paymentTerms: String(field(row, ["Payment terms", "Conditions de paiement"])), taxCode: String(field(row, ["Tax code", "Code de taxe"])), subtotal: toNumber(field(row, ["Subtotal", "Sous-total"])), taxRate: toNumber(field(row, ["Tax rate", "Taux de taxe"])), tax: toNumber(field(row, ["Tax", "Taxes"])), gstAmount: toNumber(field(row, ["GST", "TPS"])), qstAmount: toNumber(field(row, ["QST", "TVQ"])), hstAmount: toNumber(field(row, ["HST", "TVH"])), total: toNumber(field(row, ["Total", "Montant total"])), items: [] })).filter((row) => row.title || row.number);
  const itemRows = records(sheetByName(sheets, ["EstimateItems", "Lignes de soumission", "Quote items"])); result.estimateItems = itemRows.map((row) => ({ id: String(field(row, ["ID"])), estimateId: String(field(row, ["Estimate ID", "Soumission ID"])), description: String(field(row, ["Description", "Item", "Article"])), quantity: toNumber(field(row, ["Quantity", "Quantité"], 1)), unitPrice: toNumber(field(row, ["Unit price", "Prix unitaire"])), total: toNumber(field(row, ["Total", "Montant"])) })).filter((row) => row.description);
  const paymentRows = records(sheetByName(sheets, ["EstimatePayments", "Paiements de soumission", "Quote payments"])); result.paymentSchedule = paymentRows.map((row) => ({ id: String(field(row, ["ID"])), estimateId: String(field(row, ["Estimate ID", "Soumission ID"])), label: String(field(row, ["Label", "Jalon", "Paiement"])), percentage: toNumber(field(row, ["Percentage", "%"])), amount: toNumber(field(row, ["Amount", "Montant"])), dueDate: toDate(field(row, ["Due date", "Échéance"])), status: String(field(row, ["Status", "État"], "pending")), paidDate: toDate(field(row, ["Paid date", "Date de paiement"])) })).filter((row) => row.estimateId && (row.label || row.amount));
  const companyRows = records(sheetByName(sheets, ["Company", "Entreprise", "Company settings"])); const company = {}; companyRows.forEach((row) => { const key = normalizeHeader(field(row, ["Field", "Champ"])); const value = String(field(row, ["Value", "Valeur"], "")); const mapping = { tradename: "tradeName", legalname: "legalName", businessnumber: "businessNumber", province: "province", email: "email", phone: "phone", address: "address", website: "website" }; if (mapping[key]) company[mapping[key]] = value; }); const branding = {}; companyRows.forEach((row) => { const key = normalizeHeader(field(row, ["Field", "Champ"])); const value = String(field(row, ["Value", "Valeur"], "")); const mapping = { brandprimary: "primary", brandaccent: "accent", brandfooter: "footer", defaulttemplateid: "defaultTemplateId" }; if (mapping[key]) branding[mapping[key]] = value; });
  const templateRows = records(sheetByName(sheets, ["EstimateTemplates", "Modèles de soumission", "Templates"])); const templates = templateRows.map((row) => ({ id: String(field(row, ["ID"])), name: String(field(row, ["Name", "Nom"])), layout: String(field(row, ["Layout", "Style"], "modern")), primary: String(field(row, ["Primary", "Couleur principale"])), accent: String(field(row, ["Accent", "Couleur secondaire"])), showLogo: !["false", "0", "non", "no"].includes(String(field(row, ["Show logo", "Afficher le logo"], true)).toLowerCase()), showPaymentSchedule: !["false", "0", "non", "no"].includes(String(field(row, ["Show payment schedule", "Afficher l’échéancier"], true)).toLowerCase()), footer: String(field(row, ["Footer", "Pied de page"])), builtin: ["true", "1", "yes", "oui"].includes(String(field(row, ["Built in", "Intégré"], false)).toLowerCase()) })).filter((row) => row.id && row.name); if (Object.keys(company).length || Object.keys(branding).length || templates.length) result.settings = { company, branding: { ...branding, ...(templates.length ? { templates } : {}) } };
  const paymentByEstimate = new Map(); result.paymentSchedule.forEach((row) => { if (!paymentByEstimate.has(row.estimateId)) paymentByEstimate.set(row.estimateId, []); paymentByEstimate.get(row.estimateId).push(row); }); result.estimates.forEach((estimate) => { estimate.paymentSchedule = paymentByEstimate.get(estimate.id) || []; });
  const firstSheet = Object.values(sheets)[0] || []; if (!result.transactions.length && firstSheet.length) { const fallback = records(firstSheet); if (fallback.some((row) => field(row, ["Date"]) && field(row, ["Amount", "Amount CAD", "Montant"]))) result.transactions = fallback.map((row) => ({ id: String(field(row, ["ID"])), projectId: String(field(row, ["Project ID", "Projet ID"])), date: toDate(field(row, ["Date"])), type: "expense", category: String(field(row, ["Category", "Catégorie"], "Autres dépenses")), description: String(field(row, ["Description", "Nom"])), status: "received", amount: toNumber(field(row, ["Amount", "Amount CAD", "Montant"])) })).filter((row) => row.date && row.amount > 0); }
  return result;
}
