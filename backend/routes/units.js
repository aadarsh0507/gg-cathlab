const makeMasterRouter = require('./makeMasterRouter');

module.exports = makeMasterRouter({ table: 'units', fkColumn: 'unit_id', itemLabel: 'unit' });
