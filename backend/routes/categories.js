const makeMasterRouter = require('./makeMasterRouter');

module.exports = makeMasterRouter({ table: 'categories', fkColumn: 'category_id', itemLabel: 'category', screen: 'categories' });
