const express = require('express');
const { getDatabase, getCurrentUTCTimestamp } = require('../database/init');

const router = express.Router();

// Get sell price history for a specific item variant
router.get('/:variantId', (req, res) => {
    const db = getDatabase();
    const { variantId } = req.params;

    console.log('=== Fetching price history for variant ID:', variantId);

    // Simple query first - just get the price history
    const query = `
    SELECT 
      sph.id,
      sph.selling_price,
      sph.created_at,
      sph.item_variant_id,
      s.name as staff_name
    FROM sell_price_history sph
    LEFT JOIN staff s ON sph.user_id = s.id
    WHERE sph.item_variant_id = ?
    ORDER BY sph.created_at DESC
  `;

    db.all(query, [variantId], (err, rows) => {
        if (err) {
            console.error('=== Database error:', err.message);
            return res.status(500).json({
                error: 'Database error',
                details: err.message
            });
        }

        console.log(`=== Found ${rows ? rows.length : 0} price history records`);
        console.log('=== Data:', JSON.stringify(rows, null, 2));

        res.json(rows || []);
    });
});

// Update sell price (create new history entry)
router.post('/update', (req, res) => {
    const db = getDatabase();
    const { item_variant_id, selling_price, user_id = 1 } = req.body;

    if (!item_variant_id || !selling_price) {
        return res.status(400).json({
            error: 'item_variant_id and selling_price are required'
        });
    }

    console.log('=== Updating price for variant:', item_variant_id, 'New price:', selling_price);

    // Insert new price history entry
    db.run(
        `INSERT INTO sell_price_history (item_variant_id, user_id, selling_price, created_at) 
     VALUES (?, ?, ?, ?)`,
        [item_variant_id, user_id, parseFloat(selling_price), getCurrentUTCTimestamp()],
        function (err) {
            if (err) {
                console.error('=== Error updating sell price:', err.message);
                return res.status(500).json({
                    error: 'Failed to update sell price',
                    details: err.message
                });
            }

            console.log('=== Price updated successfully, history ID:', this.lastID);

            res.json({
                message: 'Sell price updated successfully',
                historyId: this.lastID
            });
        }
    );
});

module.exports = router;
