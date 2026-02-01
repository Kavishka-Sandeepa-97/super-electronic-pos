// SIMPLIFIED - Get sell price history for an item variant
server.get('/api/sell-price-history/:variantId', (req, res) => {
    const db = getDatabase();
    const { variantId } = req.params;

    console.log('=== Fetching price history for variant ID:', variantId);

    // Simple query without complex joins
    const query = `
    SELECT 
      id,
      selling_price,
      created_at,
      user_id
    FROM sell_price_history
    WHERE item_variant_id = ?
    ORDER BY created_at DESC
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
        res.json(rows || []);
    });
});

// SIMPLIFIED - Update sell price
server.post('/api/sell-price-history/update', (req, res) => {
    const db = getDatabase();
    const { item_variant_id, selling_price, user_id = 1 } = req.body;

    if (!item_variant_id || !selling_price) {
        return res.status(400).json({
            error: 'item_variant_id and selling_price are required'
        });
    }

    console.log('=== Updating price for variant:', item_variant_id, 'New price:', selling_price);

    db.run(
        `INSERT INTO sell_price_history (item_variant_id, user_id, selling_price) 
     VALUES (?, ?, ?)`,
        [item_variant_id, user_id, parseFloat(selling_price)],
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
