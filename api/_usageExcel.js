// ─── Usage sheet generation ───────────────────────────────────────────────────
// One row per line item, case details repeated so each row stands alone when
// the sheet is filtered or pasted into a pricing workbook.
import ExcelJS from 'exceljs'
import { distributorName } from './_distributors.js'

const COLUMNS = [
  { header: 'Date', key: 'date', width: 12 },
  { header: 'Hospital', key: 'hospital', width: 10 },
  { header: 'Surgeon', key: 'surgeon', width: 20 },
  { header: 'Patient Surname', key: 'patientSurname', width: 18 },
  { header: 'Patient First Name', key: 'patientFirstName', width: 18 },
  { header: 'Patient UR Number', key: 'patientUrNumber', width: 18 },
  { header: 'Procedure', key: 'procedure', width: 18 },
  { header: 'Distributor', key: 'distributor', width: 24 },
  { header: 'System / Product Name', key: 'productName', width: 30 },
  { header: 'Reference Code', key: 'referenceCode', width: 18 },
  { header: 'Lot Number', key: 'lotNumber', width: 18 },
  { header: 'Description', key: 'description', width: 30 },
  { header: 'Size / Dimensions', key: 'size', width: 18 },
  { header: 'Quantity', key: 'quantity', width: 10 },
  { header: 'Rebate Code', key: 'rebateCode', width: 14 },
  { header: 'Unit Price', key: 'unitPrice', width: 12 },
  { header: 'Extended Price', key: 'extendedPrice', width: 14 },
  { header: 'Rep Name', key: 'repName', width: 18 },
  { header: 'Manual Review Flag', key: 'manualReview', width: 18 },
  { header: 'Notes', key: 'notes', width: 34 }
]

const NAVY = 'FF042746'
const AMBER = 'FFFFF3CD'

// Returns an xlsx Buffer. `items` is already filtered by the caller — pass a
// single distributor's items for an email attachment, or all of them for the
// copy that goes to Dropbox.
export async function buildUsageWorkbook(caseRecord, items) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'TechnoMed Staff Portal'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet('Usage', {
    views: [{ state: 'frozen', ySplit: 1 }]
  })
  sheet.columns = COLUMNS

  const header = sheet.getRow(1)
  header.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
  header.alignment = { vertical: 'middle', horizontal: 'left' }
  header.height = 22

  for (const item of items) {
    const row = sheet.addRow({
      date: caseRecord.date,
      hospital: caseRecord.hospital,
      surgeon: caseRecord.surgeonName || caseRecord.surgeonSurname,
      patientSurname: caseRecord.patientSurname,
      patientFirstName: caseRecord.patientFirstName,
      patientUrNumber: caseRecord.patientUrNumber,
      procedure: caseRecord.procedure,
      distributor: item.distributor || (item.distributorKey ? distributorName(item.distributorKey) : ''),
      productName: item.productName,
      referenceCode: item.referenceCode,
      lotNumber: item.lotNumber,
      description: item.description,
      size: item.size,
      quantity: item.quantity,
      rebateCode: item.rebateCode,
      unitPrice: null,
      extendedPrice: null,
      repName: caseRecord.repName,
      manualReview: item.manualReview ? 'YES' : 'NO',
      notes: [item.notes, ...(item.reviewReasons || [])].filter(Boolean).join('; ')
    })

    // Extended Price stays a live formula so it fills in the moment a unit
    // price is typed, rather than needing a recalculation pass.
    const unitCell = row.getCell('unitPrice')
    const qtyCell = row.getCell('quantity')
    row.getCell('extendedPrice').value = {
      formula: `IF(${unitCell.address}="","",${qtyCell.address}*${unitCell.address})`
    }
    unitCell.numFmt = '#,##0.00'
    row.getCell('extendedPrice').numFmt = '#,##0.00'

    if (item.manualReview) {
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AMBER } }
      })
    }
  }

  sheet.autoFilter = { from: 'A1', to: { row: 1, column: COLUMNS.length } }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
