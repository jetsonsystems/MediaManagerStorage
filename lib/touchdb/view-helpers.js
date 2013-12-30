//
// view-helpers.js: Helpers with respect to working with views.
//
var util   = require('util');
var _      = require('underscore');
var log    = require('log4js').getLogger("plm.MediaManagerStorage");
var async  = require('async');
var DocIteratorModule = require('./doc-iter');

var moduleName = './lib/touchdb/view-helpers';
var logPrefix = moduleName + ': ';

exports = module.exports = function(database, host, port) {

  var DocIterator = DocIteratorModule(database, host, port);

  //
  // iterateOverView: iterate over a view fetching documents.
  //
  //  Args:
  //    designDoc
  //    viewName
  //    options:
  //      pageSize: page size during iteration. Default is 100.
  //      startKey: key to start paging at.
  //      startKeyDocId: doc id associated with start key.
  //      endKey: end key to stop iteration at.
  //      endKeyDocId: doc id associated with end key.
  //      direction: 'ascending' | 'descending', default is 'ascending'.
  //      returnRows: Return couchdb rows which include 'id', 'key', and 'doc' fields.
  //      skip: Iterate skipping over previous pages. Default is false. Use this for views
  //        where same key can produce multiple docs. TouchDB seems to have a bug with
  //        startkey_docid.
  //      callback(err, docs):
  //
  function iterateOverView(designDoc, viewName, options) {

    var lp = moduleName + '.iterateOverView: ';

    var options = options || {};
    var callback = options.callback || undefined;

    var pageSize = options.pageSize ? options.pageSize : 100;

    var iterOpts = {};

    _.each(['startKey', 'startKeyDocId', 'endKey', 'endKeyDocId', 'endKeyDocId', 'direction', 'returnRows', 'skip'],
           function(iOpt) {
             if (_.has(options, iOpt)) {
               iterOpts[iOpt] = options[iOpt];
             }
           });

    var dIt = new DocIterator.Iter(
      pageSize,
      designDoc,
      viewName,
      iterOpts
    );

    var docs = [];

    function iterate() {
      dIt.next().then(
        function(page) {
          log.debug(lp + 'Got ' + page.length + ' items...');
          if (page.length >	0) {
            docs = docs.concat(page);
          }
          return page;
        },
        function(err) {
          if (err.name !== 'StopIteration') {
            log.error(lp + 'error - ' + err);
          }
          throw err;
        }).then(
          function(page) {
            iterate();
          },
          function(err) {
            if (callback) {
              if (err.name === 'StopIteration') {
                log.debug(lp + 'iterated over ' + docs.length + ' items...');
                callback(null, docs);
              }
              else {
                callback(err);
              }
            }
          });
    }
    
    iterate();
  }

  //
  // iterateOverViewKeys: For each key, iterate of the results matching that key.
  //  Useful for views that return many documents for the same key.
  //
  //  Args:
  //    designDoc
  //    viewName
  //    keys
  //    options:
  //      pageSize: page size during iteration. Default is 100.
  //      returnRows: Return couchdb rows which include 'id', 'key', and 'doc' fields. 
  //        Normally, docs are returned.
  //      callback(err, docs):
  //
  function iterateOverViewKeys(designDoc, viewName, keys, options) {
    
    var lp = 'iterateOverViewKeys: ';
    
    log.debug(lp + 'view - ' + viewName + ', keys - ' + keys + ', options - ' + util.inspect(options));

    options = options || {};

    var callback = options.callback || undefined;
    var docs = [];
    var keyIdx = 0;
    async.whilst(
      function() { return keyIdx < keys.length; },
      function(innerCallback) {

        //
        // For a given key, we iterate over the view to get the results.
        //

        var keyToFetch = keys[keyIdx];
        log.debug('iterateOverViewKeys: Fetching key ' + keyToFetch+ ', at idx - ' + keyIdx + '.');

        var iterOpts = {skip: true};

        _.each(['pageSize', 'returnRows'],
               function(iOpt) {
                 if (_.has(options, iOpt)) {
                   iterOpts[iOpt] = options[iOpt];
                 }
               });

        iterOpts.startKey = keyToFetch;
        iterOpts.endKey = keyToFetch;

        iterOpts.callback = function(err, docsFetched) {
          if (!err && docsFetched) {
            log.debug('iterateOverViewKeys: Adding ' + docsFetched.length + ' documents to result set...');
            docs.push.apply(docs, docsFetched);
            log.debug('iterateOverViewKeys: Total documents fetched - ' + docs.length);
          }
          innerCallback(err);
        }

        iterateOverView(designDoc, viewName, iterOpts);

        keyIdx = keyIdx + 1;
      },
      function(err) {
        log.debug('iterateOverViewKeys: Finished iterating over view, fetched - ' + docs.length);
        callback && callback(err, docs);
      }
    );
  }

  return {
    iterateOverView: iterateOverView,
    iterateOverViewKeys: iterateOverViewKeys
  };
};
