var _ = require('underscore');
require('mootools');
var Persistent = require('../plm-persistent');

module.exports = new Class({
  Extends: Persistent,

  initialize : function(args)
  {
    this.parent(args);
    this.class_name = 'plm.StorageRef'; 

    this.doc_id  = '';
    this.desc = '';
    this.state = {
      status: undefined,
      store_started_at: undefined,
      store_completed_at: undefined
    };

    //
    // Datastore specific meta-data to reference the document or asset.
    //
    ref: {};
    
    if (_.isObject(args)) {
      for (var key in args) {
        this[key] = args[key];
      }
    }
  },

  //
  // JSON representation:
  //
  toJSON : function() {
  }

});
