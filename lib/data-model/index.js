var StorageRef = require('./plm-storage-ref/StorageRef');
var Image = require('./plm-image/Image');
var ImportBatch = require('./plm-image/ImportBatch');
var InkImporter = require('./plm-ink-importer/InkImporter');

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
    else if (className === 'plm.InkImporter') {
      return new InkImporter(attr);
    }
    else {
      var msg = 'MediaManagerStorage/lib/data-model: Invalid object class - ' + className;
      throw Object.create(new Error(msg),
                          { name: { value: 'InvalidClass' }
                          });
    }
  }

};



