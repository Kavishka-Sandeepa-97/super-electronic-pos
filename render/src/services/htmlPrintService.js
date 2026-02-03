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

const htmlPrintService = {
  printBillHTML: async (order = {}, storeInfo = {}) => {
    try {
      const { id, items = [], cashier, paymentMethod, amountPaid, tender_cash, discount_type, discount_value, additional_charges } = order;

      // Calculate totals
      let subtotal = 0;
      items.forEach((it) => {
        const qty = parseFloat(it.quantity || it.qty || 0) || 0;
        const price = parseFloat(it.price || it.unit_price || 0) || 0;
        subtotal += qty * price;
      });

      // Calculate discount amount
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

      // Simple inline CSS optimized for receipt-like printouts
      const styles = `
        <style>
          @media print {
            @page { margin: 0; }
            body { margin: 0; }
          }
          body { font-family: monospace, Arial, Helvetica, sans-serif; color: #000; }
          .receipt { width: 320px; padding: 8px; }
          .center { text-align: center; }
          .right { text-align: right; }
          h2 { margin: 4px 0; font-size: 24px; }
          .small { font-size: 14px; }
          table { width: 100%; border-collapse: collapse; }
          .items td { padding: 2px 0; word-wrap: break-word; white-space: normal; }
          .items td:first-child { width: 60%; word-break: break-all; }
          .items td:nth-child(2) { width: 10%; text-align: center;}
          .items td:nth-child(3) { width: 30%; text-align: center; }
          .sep { border-top: 1px dashed #000; margin: 8px 0; }
        </style>
      `;

      const itemsHtml = items.map(it => {
        const itemName = (it.item_name || it.itemName || 'Item').toString();
        const variantName = (it.variant_name || it.variantName || '').toString();
        const displayName = variantName ? `${itemName} (${variantName})` : itemName;
        const qty = parseFloat(it.quantity || it.qty || 0) || 0;
        const price = parseFloat(it.price || it.unit_price || 0) || 0;
        const lineTotal = (qty * price).toFixed(2);
        return `<tr class="items"><td>${displayName}</td><td>${qty}</td><td class="right">${lineTotal}</td></tr>`;
      }).join('');

      const html = `
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
                  <tr><th style="text-align:left">Item</th><th>Qty</th><th class="center">Total</th></tr>
                </thead>
                <tbody>
                  ${itemsHtml}
                </tbody>
              </table>

              <div class="sep"></div>

              <table>
                <tr><td>Subtotal</td><td class="center">${currency} ${subtotal.toFixed(2)}</td></tr>
                ${discountAmount > 0 ? `<tr><td>Discount${discount_type === 'percent' ? ` (${discount_value}%)` : ''}</td><td class="center">- ${currency} ${discountAmount.toFixed(2)}</td></tr>` : ''}
                ${additionalCharges > 0 ? `<tr><td>Additional Charge</td><td class="center">${currency} ${additionalCharges.toFixed(2)}</td></tr>` : ''}
                <tr><td><strong>TOTAL</strong></td><td class="center"><strong>${currency} ${total.toFixed(2)}</strong></td></tr>
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

      const { id, items = [], cashier, paymentMethod, amountPaid, tender_cash, discount_type, discount_value, additional_charges } = order;

      // Calculate totals
      let subtotal = 0;
      items.forEach((it) => {
        const qty = parseFloat(it.quantity || it.qty || 0) || 0;
        const price = parseFloat(it.price || it.unit_price || 0) || 0;
        subtotal += qty * price;
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

      // Build plain text receipt for thermal printer (80mm width ~ 48 chars)
      const WIDTH = 48;
      const center = (text) => {
        const pad = Math.max(0, Math.floor((WIDTH - text.length) / 2));
        return ' '.repeat(pad) + text;
      };
      const line = '-'.repeat(WIDTH);
      const doubleLine = '='.repeat(WIDTH);

      let receipt = '';
      receipt += center(storeInfo.name || 'SUPER GLOW') + '\n';
      if (storeInfo.address) receipt += center(storeInfo.address) + '\n';
      if (storeInfo.phone) receipt += center(storeInfo.phone) + '\n';
      receipt += doubleLine + '\n';
      receipt += `Order #: ${id || ''}\n`;
      receipt += `Date: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}\n`;
      receipt += `Cashier: ${cashier === 'Admin' ? 'System' : (cashier || 'System')}\n`;
      receipt += line + '\n';
      
      // Items header
      receipt += 'Item                      Qty      Total\n';
      receipt += line + '\n';
      
      // Items
      items.forEach((it) => {
        const itemName = (it.item_name || it.itemName || 'Item').toString();
        const variantName = (it.variant_name || it.variantName || '').toString();
        let displayName = variantName ? `${itemName} (${variantName})` : itemName;
        if (displayName.length > 24) displayName = displayName.substring(0, 21) + '...';
        
        const qty = parseFloat(it.quantity || it.qty || 0) || 0;
        const price = parseFloat(it.price || it.unit_price || 0) || 0;
        const lineTotal = (qty * price).toFixed(2);
        
        receipt += displayName.padEnd(26) + qty.toString().padStart(3) + lineTotal.padStart(12) + '\n';
      });
      
      receipt += line + '\n';
      receipt += `Subtotal:`.padEnd(36) + `${currency} ${subtotal.toFixed(2)}\n`;
      
      if (discountAmount > 0) {
        const discLabel = discount_type === 'percent' ? `Discount (${discount_value}%):` : 'Discount:';
        receipt += discLabel.padEnd(36) + `- ${currency} ${discountAmount.toFixed(2)}\n`;
      }
      
      if (additionalCharges > 0) {
        receipt += `Additional Charge:`.padEnd(36) + `${currency} ${additionalCharges.toFixed(2)}\n`;
      }
      
      receipt += doubleLine + '\n';
      receipt += `TOTAL:`.padEnd(36) + `${currency} ${total.toFixed(2)}\n`;
      receipt += doubleLine + '\n';
      receipt += `Payment: ${paymentMethod || 'cash'}\n`;
      receipt += `Paid: ${currency} ${paid.toFixed(2)}\n`;
      if (paid > 0) {
        receipt += `Change: ${currency} ${change >= 0 ? change.toFixed(2) : '0.00'}\n`;
      }
      receipt += '\n';
      receipt += center(storeInfo.receiptFooter || 'Thank you for your visit!') + '\n';
      receipt += '\n\n\n'; // Paper feed

      // Send to thermal printer
      const result = await ipcRenderer.invoke('print-receipt', {
        content: receipt,
        printerName: savedPrinter
      });

      return result;
    } catch (error) {
      return { success: false, message: error.message };
    }
  }
};

export default htmlPrintService;
