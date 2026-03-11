// HTML/CSS print service for browser/Electron printing
// Opens a window containing a printable receipt and triggers window.print()

// Helper to get ipcRenderer in Electron environment
const getIpcRenderer = () => {
  try {
    if (typeof window !== 'undefined' && window.require) {
      const { ipcRenderer } = window.require('electron');
      return ipcRenderer;
    }
    return null;
  } catch (error) {
    console.error('Failed to get ipcRenderer:', error);
    return null;
  }
};

// Get receipt font settings from localStorage
const getReceiptFontSettings = () => {
  const fontFamily = localStorage.getItem('receiptFontFamily') || 'Arial';
  const fontWeight = localStorage.getItem('receiptFontWeight') || 'bold';
  const fontSize = localStorage.getItem('receiptFontSize') || '13';
  return { fontFamily, fontWeight, fontSize };
};

// Build receipt HTML used by both browser and thermal printing
const buildReceiptHTML = (order = {}, storeInfo = {}) => {
  const { id, items = [], cashier, paymentMethod, amountPaid, tender_cash, discount_type, discount_value, additional_charges } = order;
  const { fontFamily, fontWeight, fontSize } = getReceiptFontSettings();

  // Calculate totals
  let subtotal = 0;
  let originalSubtotal = 0;
  let totalItemDiscounts = 0;
  items.forEach((it) => {
    const qty = parseFloat(it.quantity || it.qty || 0) || 0;
    const price = parseFloat(it.price || it.unit_price || 0) || 0;
    const origPrice = parseFloat(it.original_price || it.originalPrice || 0) || price;
    subtotal += qty * price;
    originalSubtotal += qty * origPrice;
    totalItemDiscounts += (parseFloat(it.item_discount_amount || it.discount_amount || it.discountAmount || 0) || 0) * qty;
  });

  let discountAmount = 0;
  if (discount_type === 'percent' && discount_value > 0) {
    discountAmount = (subtotal * discount_value) / 100;
  } else if (discount_type === 'fixed' && discount_value > 0) {
    discountAmount = discount_value;
  }

  const additionalCharges = parseFloat(additional_charges || order.additionalCharges || 0) || 0;
  const total = subtotal - discountAmount + additionalCharges;
  const paid = parseFloat(amountPaid || tender_cash || 0) || 0;
  const change = paid - total;
  const currency = 'Rs';

  const styles = `
    <style>
      @media print {
        @page { margin: 0; }
        body { margin: 0; }
      }
      * { box-sizing: border-box; }
      body {
        font-family: '${fontFamily}', Arial, Helvetica, sans-serif;
        font-weight: ${fontWeight};
        font-size: ${fontSize}px;
        color: #000;
        -webkit-print-color-adjust: exact;
      }
      .receipt { width: 320px; padding: 8px; }
      .center { text-align: center; }
      .right { text-align: right; }
      h2 { margin: 4px 0; font-size: 22px; font-weight: 900; letter-spacing: 1px; }
      .small { font-size: 12px; }
      table { width: 100%; border-collapse: collapse; }
      .items td { padding: 2px 0; word-wrap: break-word; white-space: normal; }
      .items td:first-child { width: 60%; word-break: break-all; }
      .items td:nth-child(2) { width: 10%; text-align: center; }
      .items td:nth-child(3) { width: 30%; text-align: right; }
      .disc-row td { font-size: 10px; color: #333; padding: 0 0 2px 8px; font-weight: normal; }
      .sep { border-top: 1px dashed #000; margin: 6px 0; }
      .total-row td { font-size: 15px; font-weight: 900; }
    </style>
  `;

  const itemsHtml = items.map(it => {
    const itemName = (it.item_name || it.itemName || 'Item').toString();
    const variantName = (it.variant_name || it.variantName || '').toString();
    const displayName = variantName ? `${itemName} (${variantName})` : itemName;
    const qty = parseFloat(it.quantity || it.qty || 0) || 0;
    const price = parseFloat(it.price || it.unit_price || 0) || 0;
    const lineTotal = (qty * price).toFixed(2);
    const discAmt = parseFloat(it.item_discount_amount || it.discount_amount || it.discountAmount || 0) || 0;
    const discSource = it.discount_source || it.discountSource || '';
    const discType = it.item_discount_type || it.discount_type || it.discountType || '';
    const discVal = parseFloat(it.item_discount_value || it.discount_value || it.discountValue || 0) || 0;
    let row = `<tr class="items"><td>${displayName}</td><td>${qty}</td><td class="right">${lineTotal}</td></tr>`;
    if (discAmt > 0 && discSource) {
      const discLabel = discSource === 'item' ? 'Item Disc' : discSource === 'brand' ? 'Brand Disc' : discSource === 'global' ? 'Global Disc' : 'Disc';
      const discInfo = discType === 'percentage' ? `${discVal}%` : `${currency} ${discVal.toFixed(2)}`;
      row += `<tr class="disc-row"><td colspan="3">&nbsp;&nbsp;${discLabel}: -${discInfo} per unit</td></tr>`;
    }
    return row;
  }).join('');

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Receipt</title>
        ${styles}
      </head>
      <body>
        <div class="receipt">
          <div class="center">
            <h2>${storeInfo.name || 'STORE'}</h2>
            <div class="small">${storeInfo.address || ''}</div>
            <div class="small">${storeInfo.phone || ''}</div>
          </div>

          <div class="sep"></div>

          <div>
            <div>Order #: ${id || ''}</div>
            <div>Date: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}</div>
            <div>Cashier: ${cashier === 'Admin' ? 'System' : (cashier || 'System')}</div>
          </div>

          <div class="sep"></div>

          <table>
            <thead>
              <tr><th style="text-align:left">Item</th><th>Qty</th><th style="text-align:right">Total</th></tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>

          <div class="sep"></div>

          <table>
            <tr><td>Subtotal</td><td class="right">${currency} ${totalItemDiscounts > 0 ? originalSubtotal.toFixed(2) : subtotal.toFixed(2)}</td></tr>
            ${totalItemDiscounts > 0 ? `<tr><td>Item Discounts</td><td class="right">- ${currency} ${totalItemDiscounts.toFixed(2)}</td></tr>` : ''}
            ${discountAmount > 0 ? `<tr><td>Discount${discount_type === 'percent' ? ` (${discount_value}%)` : ''}</td><td class="right">- ${currency} ${discountAmount.toFixed(2)}</td></tr>` : ''}
            ${additionalCharges > 0 ? `<tr><td>Additional Charge</td><td class="right">${currency} ${additionalCharges.toFixed(2)}</td></tr>` : ''}
            <tr class="total-row"><td>TOTAL</td><td class="right">${currency} ${total.toFixed(2)}</td></tr>
          </table>

          <div class="sep"></div>

          <div>Payment: ${paymentMethod || 'cash'}</div>
          <div>Paid: ${currency} ${paid.toFixed(2)}</div>
          ${paid > 0 ? `<div>Change: ${currency} ${change >= 0 ? change.toFixed(2) : '0.00'}</div>` : ''}

          <div class="center small" style="margin-top:12px">${storeInfo.receiptFooter || 'Thank you for your visit!'}</div>
        </div>
      </body>
    </html>
  `;
};

const htmlPrintService = {
  printBillHTML: async (order = {}, storeInfo = {}) => {
    try {
      const html = buildReceiptHTML(order, storeInfo);

      // Open a new window and print
      const printWindow = window.open('', '_blank', 'width=360,height=600');
      if (!printWindow) {
        return { success: false, message: 'Unable to open print window (pop-up blocked).' };
      }

      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();

      // Give the new window a small moment to render before calling print
      setTimeout(() => {
        try {
          printWindow.print();
          // close after printing
          printWindow.close();
        } catch (e) {
          // ignore print errors
        }
      }, 300);

      return { success: true };
    } catch (error) {
      return { success: false, message: error.message };
    }
  },

  // Direct thermal printer printing (for XP-80C and similar thermal printers)
  printDirectThermal: async (order = {}, storeInfo = {}) => {
    try {
      const ipcRenderer = getIpcRenderer();
      const savedPrinter = localStorage.getItem('selectedPrinter');
      
      if (!ipcRenderer) {
        return { success: false, message: 'Direct printing only available in desktop app' };
      }
      
      if (!savedPrinter) {
        return { success: false, message: 'No printer selected. Please go to Settings > Printer Settings' };
      }

      const html = buildReceiptHTML(order, storeInfo);

      // Send HTML to thermal printer via Electron silent print
      const result = await ipcRenderer.invoke('print-receipt', {
        content: html,
        printerName: savedPrinter
      });

      return result;
    } catch (error) {
      return { success: false, message: error.message };
    }
  },

  // Print barcode labels for XP-H500B label printer (35mm x 20mm, 3 columns)
  printBarcodeLabels: async (item, quantity = 1, printerName = null) => {
    try {
      const barcode = item.barcode || '';
      const price = parseFloat(item.selling_price || item.price || 0);
      const shopName = 'SUPER GLOW';
      
      // Get printer name from localStorage if not provided
      const labelPrinter = printerName || localStorage.getItem('barcodePrinter') || 'Xprinter XP-H500B';
      
      // Label dimensions: 35mm x 20mm, 3 columns per row
      // Total width: ~108mm (4.25 in), height per label: ~20mm (0.80 in)
      const labelsPerRow = 3;
      const totalRows = Math.ceil(quantity / labelsPerRow);
      
      // Generate HTML for barcode labels
      const styles = `
        <style>
          @media print {
            @page {
              size: 4.25in 0.78in;
              margin: 0;
            }
            body { margin: 0; padding: 0; }
          }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { 
            font-family: Arial, sans-serif; 
            font-size: 8px;
          }
          .label-row {
            display: flex;
            width: 4.25in;
            height: 0.78in;
            page-break-after: always;
            page-break-inside: avoid;
            break-after: page;
          }
          .label {
            width: 1.42in;
            height: 0.76in;
            padding: 0px 3px 2px 3px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: flex-start;
            text-align: center;
          }
          .label:last-child {
          }
          .shop-name {
            font-size: 10px;
            font-weight: bold;
            margin-top: -2px;
          }
          .barcode-container {
            margin: 0px 0;
          }
          .barcode-container svg {
            max-width: 0.95in;
            height: 22px;
          }
          .barcode-number {
            font-size: 7px;
            font-family: monospace;
            font-weight: 600;
            margin-top: 0px;
            color: #000;
            letter-spacing: 2px;
          }
          .price {
            font-size: 14px;
            font-weight: bold;
            margin-top: 2px;
          }
        </style>
      `;

      // Generate barcode SVG using Code128
      const generateBarcodeSVG = (code) => {
        if (!code) return '';
        // Simple Code128 representation - using a web-based barcode generator approach
        const barcodeId = 'bc_' + Math.random().toString(36).substr(2, 9);
        return `<svg id="${barcodeId}" class="barcode"></svg>
                <script>
                  if (typeof JsBarcode !== 'undefined') {
                    JsBarcode("#${barcodeId}", "${code}", {
                      format: "CODE128",
                      width: 1.5,
                      height: 25,
                      displayValue: false,
                      margin: 0
                    });
                  }
                </script>`;
      };

      // Build labels HTML
      let labelsHtml = '';
      let labelCount = 0;
      
      for (let row = 0; row < totalRows; row++) {
        labelsHtml += '<div class="label-row">';
        
        for (let col = 0; col < labelsPerRow && labelCount < quantity; col++) {
          labelsHtml += `
            <div class="label">
              <div class="shop-name">${shopName}</div>
              <div class="barcode-container">
                ${generateBarcodeSVG(barcode)}
              </div>
              <div class="barcode-number">${barcode}</div>
              <div class="price">Rs. ${price.toFixed(2)}</div>
            </div>
          `;
          labelCount++;
        }
        
        // Fill remaining slots with empty labels if needed
        const remaining = labelsPerRow - (labelCount % labelsPerRow || labelsPerRow);
        if (labelCount >= quantity && remaining < labelsPerRow) {
          for (let i = 0; i < remaining; i++) {
            labelsHtml += '<div class="label"></div>';
          }
        }
        
        labelsHtml += '</div>';
      }

      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8" />
            <title>Barcode Labels - ${barcode}</title>
            <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>
            ${styles}
          </head>
          <body>
            ${labelsHtml}
            <script>
              // Generate all barcodes after page load
              window.onload = function() {
                document.querySelectorAll('.barcode').forEach(function(svg) {
                  const id = svg.id;
                  if (typeof JsBarcode !== 'undefined') {
                    try {
                      JsBarcode("#" + id, "${barcode}", {
                        format: "CODE128",
                        width: 1.5,
                        height: 25,
                        displayValue: false,
                        margin: 0
                      });
                    } catch(e) { console.error(e); }
                  }
                });
                // Auto print after short delay
                setTimeout(function() {
                  window.print();
                }, 500);
              };
            </script>
          </body>
        </html>
      `;

      // Open print window
      const printWindow = window.open('', '_blank', 'width=450,height=300');
      if (!printWindow) {
        return { success: false, message: 'Unable to open print window (pop-up blocked).' };
      }

      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();

      return { success: true, message: `Printing ${quantity} barcode label(s)` };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }
};

export default htmlPrintService;
