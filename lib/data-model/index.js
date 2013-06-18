var Image = require('./plm-image/Image');
var ImportBatch = require('./plm-image/ImportBatch');

module.exports = {

  docFactory: function(className, attr) {
    if (className === 'plm.Image') {
      return new Image(attr);
    }
    else if (className === 'plm.ImportBatch') {
      return new ImportBatch(attr);
    }
  }

};



