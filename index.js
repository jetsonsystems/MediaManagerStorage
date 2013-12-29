//
// MediaManagerStorage: Interface to various data stores used within the PLM APP.
//
//  See ./README.md for details.
//
//  In short, instantiate as a singleton one time with a config. Following methods are exposed:
//
//    get(<storage sub-module>): Instantiate the touchdb or gdrive "storage sub-modules".
//    docFactory: Create an in memory JSON representationof a document. Use the docFactory method if provided
//      by the <storage sub-module> instead to be able to create/read/update/delete in that storage context.
//
var _ = require('underscore');
var log = require('log4js').getLogger("plm.MediaManagerStorage");
var dataModel = require('./lib/data-model');

var moduleName = 'plm.MediaManagerStorage';

//
// storageInst: singleton instance of the module.
//
var storageInst = null;

module.exports = function storageModule(config, opts) {
  var logPrefix = moduleName + ': ';

  var options = opts || {};
  if (!_.has(options, 'singleton')) {
    options.singleton = true;
  }

  if (options.singleton && (storageInst !== null)) {
    //
    //  Not the first time, you can leave off the config. Otherwise, it must be the same as the previous one.
    //
    if (config && !_.isEqual(storageInst.config, config)) {
      log.error(logPrefix + 'Single config. conflict, singleton config - ' + JSON.stringify(storageInst.config) + ', new config - ' + JSON.stringify(config));
      throw Object.create(new Error(),
                          { name: { value: 'ReinstantiatingWithDifferentConfig' },
                            message: { value: logPrefix + 'Reinstantiating with a different configuration. Module is a singleton.' } });
    }
    return storageInst;
  }

  //
  //  Must pass a config. the first time.
  //
  if (!config) {
    throw Object.create(new Error(),
                        { name: { value: 'NoConfig' },
                          message: { value: logPrefix + 'A config. is required to instantiate the module.' } });
  }


  //
  //  storageInst: The return object as a result of module initialization.
  //
  var newInst = Object.create({}, { 
    config: { value: config },
    get: { value: function(storageSubModule, options) {
      var toLoad = storageSubModule || 'touchdb';

      if (toLoad === 'touchdb') {
        return require('./lib/touchdb')(config);
      }
      else if (toLoad === 'gdrive') {
        return require('./lib/gdrive');
      }
      else if (toLoad === 'file-cache') {
        return require('./lib/file-cache')(options);
      }
      else {
        throw Object.create(new Error(),
                            { name: { value: 'InvalidStorageSubModule' },
                              message: { value: logPrefix + 'Invalid storage sub-module, must be either touchdb or gdrive! Defaults to touchdb.' } });
      }
    }},
    docFactory: { value: function(className, attrs) {
      return dataModel.docFactory(className, attrs);
    }}
  });

  if (options.singleton) {
    storageInst = newInst;
  }

  return newInst;

};
