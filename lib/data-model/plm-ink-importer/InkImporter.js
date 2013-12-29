'use strict';
require('mootools');

var 
  _ = require('underscore')
  ,Event = require('../plm-event/Event')
  ,Persistent = require('../plm-persistent')
;


// ImportBatch represents basic information on an batch import process
// ----------------------------------------------
module.exports = new Class(
{
  Extends: Persistent,
  Implements: process.EventEmitter,

  // constants for status values
  statuses : {

    INIT     : 'INIT',
    STARTED  : 'STARTED',
    ABORT_REQUESTED  : 'ABORT-REQUESTED',
    ABORTING  : 'ABORTING',
    ABORTED  : 'ABORTED',
    COMPLETED: 'COMPLETED',
    ERROR:     'ERROR'
  },

  // constants for event names
  event: {
    STARTED:    "ink-import.started",
    IMG_CREATED: "ink-import.image.created",
    IMGS_CREATED: "ink-import.images.created",
    IMG_VARIANT_CREATED: "ink-import.image.variant.created",
    IMGS_VARIANT_CREATED: "ink-import.images.variant.created",
    IMG_IMPORTED: "ink-import.image.imported",
    IMGS_IMPORTED: "ink-import.images.imported",

    DOC_CREATED: "ink-import.doc.created",
    DOCS_CREATED: "ink-import.docs.created",
    DOC_VARIANT_CREATED: "ink-import.doc.variant.created",
    DOCS_VARIANT_CREATED: "ink-import.docs.variant.created",
    DOC_IMPORTED: "ink-import.doc.imported",
    DOCS_IMPORTED: "ink-import.docs.imported",

    ERROR: "ink-import.error",

    COMPLETED: "ink-import.completed"
  },


  initialize : function(args)
  {
    this.parent(args);
    this.class_name = 'plm.InkImporter'; 

    // stores the time at which the batch starts processing
    this.started_at = undefined;

    // stores the time at which the batch ended processing
    this.completed_at = undefined;

    // ink blobs to import.
    this.ink_blobs = [];

    // The status of this import. See statuses above.
    this.status = this.statuses.INIT;

    //
    // _proc: transient stuff.
    //
    this._proc = {};


    this._proc.mutable = ['status', 'num_to_import', 'num_success', 'num_error', 'num_images', 'num_docs'];

    // map of successfully imported images: image.oid -> image
    this._proc.images = {};

    // map of successfully imported docs (pdf, word, etc...): doc.oid -> doc
    this._proc.docs = {};

    //
    // Errors keyed by blob url.
    //
    this._proc.errors = {};

    //
    // stats and progress
    //
    this.num_to_import = 0;
    this.num_success   = 0;
    this.num_error     = 0;

    this.num_images    = 0;
    this.num_docs      = 0;

    var self = this;

    // TODO: move this to Persistent ?
    if (_.isObject(args)) {
      _.each(args, function(value, key) {
        if (value) { self[key] = value; }
      });
    }
  },

  _update: function(attr) {
    _.each(attr, 
           function(v, k) {
             if (_.contains(this._proc.mutable, k)) {
               this[k] = v;
             }
           },
           this);
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

  // sets the time at which the batch began processing, and changes the status to STARTED
  setStartedAt: function setStartedAt(aDate) {
    this.status = this.statuses.STARTED;
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
    if (this.status === this.statuses.STARTED) {
      this.status = this.statuses.COMPLETED;
    }
    else if (this.status === this.statuses.ABORTING) {
      this.status = this.statuses.ABORTED;
    }
    this.emit(this.event.COMPLETED, new Event(this.event.COMPLETED, this));
  },

  // returns the time at which the batch was first instantiated
  getUpdatedAt: function getUpdatedAt() {
    return this.updated_at;
  },

  setUpdatedAt: function setUpdatedAt(aDate) {
    this.updated_at = aDate;
  },

  addImagesCreated: function (images) {
    if (_.isArray(images)) {
      this.emit(this.event.IMGS_CREATED, new Event(this.event.IMGS_CREATED, images));
    }
    else {
      this.emit(this.event.IMG_CREATED, new Event(this.event.IMG_CREATED, images));
    }
  },

  addImagesVariantCreated: function(images) {
    if (_.isArray(images)) {
      this.emit(this.event.IMGS_VARIANT_CREATED, new Event(this.event.IMGS_VARIANT_CREATED, images));
    }
    else {
      this.emit(this.event.IMG_VARIANT_CREATED, new Event(this.event.IMG_VARIANT_CREATED, images));
    }
  },

  addDocsCreated: function (docs) {
    if (_.isArray(docs)) {
      this.emit(this.event.DOCS_CREATED, new Event(this.event.DOCS_CREATED, docs));
    }
    else {
      this.emit(this.event.DOC_CREATED, new Event(this.event.DOC_CREATED, docs));
    }
  },

  addDocsVariantCreated: function(docs) {
    if (_.isArray(docs)) {
      this.emit(this.event.DOCS_VARIANT_CREATED, new Event(this.event.DOCS_VARIANT_CREATED, docs));
    }
    else {
      this.emit(this.event.DOC_VARIANT_CREATED, new Event(this.event.DOC_VARIANT_CREATED, docs));
    }
  },

  addImagesSuccess: function (images) {
    var that = this;

    if (_.isArray(images)) {
      _.each(images, function(image) {
        that._proc.images[image.oid] = image;
      });
      that.emit(this.event.IMGS_IMPORTED, new Event(this.event.IMGS_IMPORTED, images));
    }
    else {
      that._proc.images[images.oid] = images;
      that.emit(this.event.IMG_IMPORTED, new Event(this.event.IMG_IMPORTED, images));
    }
  },

  addDocsSuccess: function (docs) {
    var that = this;

    if (_.isArray(docs)) {
      _.each(docs, function(doc) {
        that._proc.docs[doc.oid] = doc;
      });
      that.emit(this.event.DOCS_IMPORTED, new Event(this.event.DOCS_IMPORTED, docs));
    }
    else {
      that._proc.docs[docs.oid] = docs;
      that.emit(this.event.DOC_IMPORTED, new Event(this.event.DOC_IMPORTED, docs));
    }
  },

  /** Add an error to the map of import errors */
  addErr: function (inkBlob, anError) {
    if (!_.has(this._proc.errors, inkBlob.url)) {
      this._proc.errors[inkBlob.url] = anError;
    }
    this.emit(this.event.ERROR, new Event(this.event.ERROR, {ink_blob: inkBlob, error: anError}));
  },

  /** Returns the number of images to be processed in this importBatch */
  getNumToImport: function () {
    if (this.ink_blobs.length > 0) {
      this.num_to_import = this.ink_blobs.length;
    }
    return this.num_to_import;
  },

  /** Return the number of errors in this import batch */
  getNumError: function () {
    if (_.keys(this._proc.errors).length > 0) {
      this.num_error = _.keys(this._proc.errors).length;
    }
    return this.num_error;
  },

  /** Returns the number of images successfully imported in this import batch */
  getNumSuccess: function () {
    if (_.keys(this._proc.images).length > 0) {
      this.num_images = _.keys(this._proc.images).length;
    }
    if (_.keys(this._proc.docs).length > 0) {
      this.num_docs = _.keys(this._proc.docs).length;
    }
    this.num_success = this.num_images + this.num_docs;
    return this.num_success;
  },

  /** Returns the number of images processed in this importBatch, equal to the sum of getNumError() and getNumSuccess() */
  getNumAttempted: function () {
    return this.getNumError() + this.getNumSuccess();
  },

  getNumImages: function () {
    if (_.keys(this._proc.images).length > 0) {
      this.num_images = _.keys(this._proc.images).length;
    }
    return this.num_images;
  },

  getNumDocs: function () {
    if (_.keys(this._proc.docs).length > 0) {
      this.num_docs = _.keys(this._proc.docs).length;
    }
    return this.num_docs;
  },

  // returns a sanitized cloned instance without extraneous fields,
  // suitable for saving or encoding into json
  toJSON : function() {
    var out = Object.clone(this);
    // these two are added by mootools
    delete out.$caller;
    delete out.caller;

    delete out.statuses;
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
    out.num_images    = this.getNumImages();
    out.num_docs      = this.getNumDocs();
    return out;
  }

}); 
