var StorageRef = require('./plm-storage-ref/StorageRef');
var Image = require('./plm-image/Image');
var ImportBatch = require('./plm-image/ImportBatch');

module.exports = {

  docFactory: function(className, attr) {
    if (className === 'plm.StorageRef') {
      return new StorageRef(attr);
    }
    else if (className === 'plm.Image') {
      return new Image(attr);
    }
    else if (className === 'plm.ImportBatch') {
      return new ImportBatch(attr);
    }
  }

};



