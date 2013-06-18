'use strict';
require('mootools');

var 
  _ = require('underscore')
  ,Event = require('./Event')
  ,Persistent = require('../plm-persistent')
;


// ImportBatch represents basic information on an batch import process
// ----------------------------------------------
module.exports = new Class(
{
  Extends: Persistent,
  Implements: process.EventEmitter,

  // constants for batch status
  BATCH_INIT     : 'INIT',
  BATCH_STARTED  : 'STARTED',
  BATCH_COMPLETED: 'COMPLETED',

  // constants for event names
  event: {
    STARTED:    "import.started"
    ,IMG_SAVED: "import.image.saved"
    ,IMG_ERROR: "import.image.error"
    ,COMPLETED: "import.completed"
  },


  initialize : function(args)
  {
    this.parent(args);
    this.class_name = 'plm.ImportBatch'; 

    // stores the time at which the batch starts processing
    this.started_at = undefined;

    // stores the time at which the batch ended processing
    this.completed_at = undefined;

    // transient field that stores an array of tuples such as: 
    //   {path: 'someImagePath', format: 'jpg'}
    // for the images that this batch should import
    this.images_to_import = [];

    // transient field that stores processing data
    this._proc = {};

    // transient map of the images that were successfully imported in this batch, keyed by path; 
    // this field not persisted, images will contain a reference to the batch's oid instead
    this._proc.images = {}; 

    // map of errors in this batch, keyed by path
    // not persisted, errs will be persisted individually and contain a reference to batch oid
    this._proc.errs = {};

    // array of images imported as part of this batch
    this.images = [];

    // if this import batch resulted from a batch import of a folder, 
    // stores the root path of the import
    this.path = '';

    // The status of this batch, currently one of:
    // - empty string: unitialized batch
    // - 'INIT': a batch record was created but batch processing has not started
    // - 'STARTED': batch was triggered and is in-process
    // - 'COMPLETED': batch has finished processing, possibly with errors
    this.status = '';

    //
    // stats and progress
    //
    this.num_to_import = 0;
    this.num_success   = 0;
    this.num_error     = 0;

    var self = this;

    // TODO: move this to Persistent ?
    if (_.isObject(args)) {
      _.each(args, function(value, key) {
        if (value) { self[key] = value; }
      });
    }
  },


  getStatus: function getStatus() {
    return this.status;
  },

  setStatus: function setStatus(str) {
    this.status = str;
  },

  // returns the time at which the batch was first instantiated
  getCreatedAt: function getCreatedAt() {
    return this.created_at;
  },

  setCreatedAt: function setCreatedAt(aDate) {
    this.created_at = aDate;
  },

  // returns the time at which the batch begins processing
  getStartedAt: function getStartedAt() {
    return this.started_at;
  },

  // sets the time at which the batch began processing, and changes the status to BATCH_STARTED
  setStartedAt: function setStartedAt(aDate) {
    this.status = this.BATCH_STARTED;
    this.started_at = aDate;
    this.emit(this.event.STARTED, new Event(this.event.STARTED, this));
  },

  getCompletedAt: function getCompletedAt() {
    return this.completed_at;
  },

  /** sets the completed_at date, updates the updated_at to match */
  setCompletedAt: function setCompletedAt(aDate) {
    this.completed_at = aDate;
    this.updated_at   = aDate;
    this.status = this.BATCH_COMPLETED;
    this.emit(this.event.COMPLETED, new Event(this.event.COMPLETED, this));
  },

  // returns the time at which the batch was first instantiated
  getUpdatedAt: function getUpdatedAt() {
    return this.updated_at;
  },

  setUpdatedAt: function setUpdatedAt(aDate) {
    this.updated_at = aDate;
  },


  /** Add an image to the map of successfully processed images */
  addSuccess: function (anImage) {
    this._proc.images[anImage.path] = anImage;
    this.emit(this.event.IMG_SAVED, new Event(this.event.IMG_SAVED, anImage));
  },

  /** Add an error to the map of import errors */
  addErr: function (path, anError) {
    this._proc.errs[path] = anError;
    this.emit(this.event.IMG_ERROR, new Event(this.event.IMG_ERROR, {path: path, error: anError}));
  },


  /** Returns the number of images to be processed in this importBatch */
  getNumToImport: function () {
    if (this.images_to_import.length > 0) {
      this.num_to_import = this.images_to_import.length;
    }
    return this.num_to_import;
  },

  /** Return the number of errors in this import batch */
  getNumError: function () {
    if (_.keys(this._proc.errs).length > 0) {
      this.num_error = _.keys(this._proc.errs).length;
    }
    return this.num_error;
  },

  /** Returns the number of images successfully imported in this import batch */
  getNumSuccess: function () {
    if (_.keys(this._proc.images).length > 0) {
      this.num_success = _.keys(this._proc.images).length;
    }
    return this.num_success;
  },

  /** Returns the number of images processed in this importBatch, equal to the sum of getNumError() and getNumSuccess() */
  getNumAttempted: function () {
    return this.getNumError() + this.getNumSuccess();
  },



  // returns a sanitized cloned instance without extraneous fields,
  // suitable for saving or encoding into json
  toJSON : function() {
    var out = Object.clone(this);
    // these two are added by mootools
    delete out.$caller;
    delete out.caller;

    delete out.images_to_import;
    delete out.images;

    delete out.BATCH_INIT;
    delete out.BATCH_STARTED;
    delete out.BATCH_COMPLETED;
    delete out.event;

    // cloning will cause functions to be saved to couch if we don't remove them
    var storage = this._storage;
    for (var prop in out) {
      if ( prop.indexOf("_") === 0 || _.isFunction(out[prop]) ) {
        delete out[prop];
      }
    }
    if (_.has(storage, 'rev')) {
      out._rev = storage.rev;
    }

    out.num_to_import = this.getNumToImport();
    out.num_success   = this.getNumSuccess();
    out.num_error     = this.getNumError();
    out.num_attempted = this.getNumAttempted();
    return out;
  }

}); 

// var img = new Image();
// console.log('img: ' + JSON.stringify(img));
