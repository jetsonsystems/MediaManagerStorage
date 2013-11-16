//
// doc-pager.js: Create a CouchDB / TouchDB document pager which facilitates
//  traversing a DB via views via pagination.
//

var _ = require('underscore');
var log = require('log4js').getLogger("plm.MediaManagerStorage");
var Q = require('q');
var DocIteratorModule = require('./doc-iter');

var moduleName = './lib/touchdb/doc-pager';

var config = {
  database: undefined,
  host: undefined,
  port: undefined
};

var DocIterator = undefined;

//
// DocPager: Traverse couchdb designDoc / view via pagination. Retrieve a page of
//  documents relative to cursor. at(), previous() and next() methods are provided.
//  All methods return documents in ascending order.
//
//  Constructor Args:
//    pageSize
//    designDoc
//    view
//    options:
//      transform(doc, callback): asyncronous transform function. IE:
//        A request to get images in an import.
//      filterSync(doc): syncronous filter function.
//      direction: 'ascending' | 'descending', default is 'ascending'.
//      startKey: Terminate iteration here when going in the backward direction, ie: previous().
//        Same definition as endKey.
//      stopKey: Terminate iteration here when going in the forward direction, ie:
//        via at() or next(). Same definition as endKey.
//
//      Note: startKey and stopKey define the range of paging within the view.
//
//  cursors:
//    {
//      key: ..
//      id: ..
//    }
//
//    Note: id must be a string, or undefined when no ID is specified.
//
//  methods: Traversal methods. Each return a Q promise.
//
//    at: Return page at cursor.
//    previous: Return page previous page relative to cursor.
//    next: Return next page relative to cursor.
//
//  exceptions:
//
//    StopIteration: Is thrown when previous(), or next() cannot return any data,
//      yet, cursor is valid. Likewise, it is thrown whenever cursor is valid, yet no data 
//      can be returned. IE: All page items were filtered by filterSync.
//    IterationError: Is thrown when any other error occurs.
//      attributes:
//        message: 'iteration-error'
//        error: Any thrown error.
//
//  page: An object describing a page:
//
//    {
//      items: [ <page items> ],
//      cursors: {
//        start: cursor of first item.
//        end: cursor of last item.
//        previous: Cursor of first item in previous page. Only return via previous() and next().
//        next: Cursor of first item in next page.
//      }
//    }
//
//    <page item> ::=
//
//      {
//        cursor: Cursor associated with document.
//        doc: Document.
//      }
//
//  Usage:
//
//    var docPager = new require('./doc-pager')(<db>, <host>, <port>);
//
//    var pager = new docPager.Pager(10, <design doc>, <view>);
//
//    pager.previous(cursor).then(function(page) {
//      Do something with the page.
//    });
//
function DocPager(pageSize, designDoc, view, options) {

  var logPrefix = moduleName + '.DocPager: ';

  options = options || {};

  if (options.direction && (options.direction !== 'ascending') && (options.direction !== 'descending')) {
    throw new InvalidOptions();
  }

  options.direction = options.direction ? options.direction : 'ascending';

  this.at = function(cursor) {

    var that = this;

    var lp = logPrefix.replace(': ', '.at: ');

    var dIt = new DocIterator.Iter(
      pageSize + 1,
      designDoc,
      view,
      {
        startKey: (cursor && cursor.key) ? cursor.key : undefined,
        startKeyDocId: (cursor && cursor.id) ? cursor.id : undefined,
        endKey: options.stopKey,
        transform: options.transform,
        filterSync: options.filterSync,
        direction: options.direction,
        returnRows: true
      });
    var p = dIt.next().then(
      //
      // Fulfillment handler. Transform the pageRows, to what
      // we need to return, and return it.
      //
      function(pageRows) {
        if (!pageRows || (pageRows.length === 0)) {
          log.debug(lp + 'Promise fulfilled, but no rows retrieved!');
          throw new DocIterator.StopIteration();
        }
        else {
          log.debug(lp + 'Promise fulfilled, ' + pageRows.length + ' rows retrieved...');
          var page = rowsToPage(pageRows, 0, pageSize);
          var pFinal = Q.promise(function(resolve, reject) {
            var pPrev = that.previous(page.cursors.start);

            pPrev.then(
              function(prevPage) {
                page.cursors.previous = prevPage.cursors.start;
                resolve(page);
              },
              function(prevErr) {
                resolve(page);
              });
          });
          return pFinal;
        }
      },
      function(err) {
        log.debug(lp + 'Promise rejected...');
        if (err instanceof DocIterator.StopIteration) {
          throw err;
        }
        else if (err instanceof Error) {
          throw err;
        }
        else {
          throw new IterationError(err);
        }
      });
    return p;
  };

  //
  // previous: Get previous page relative to cursor.
  //
  //  Args:
  //    cursor: Cursor to page relative to.
  //    opts:
  //      fullPageAtEnd: Return a full page when reaching the last page as opposed to
  //        less than pageSize items.
  //
  this.previous = function(cursor, opts) {

    var that = this;

    opts = opts || {};

    opts.fullPageAtEnd = _.has(opts, 'fullPageAtEnd') ? opts.fullPageAtEnd : true;

    var lp = logPrefix.replace(': ', '.previous: ');

    log.debug(lp + 'cursor - (' + cursor.key + ', ' + cursor.id + ').');

    var viewOpts = {
      startKey: cursor.key,
      startKeyDocId: cursor.id,
      transform: options.transform,
      filterSync: options.filterSync,
      direction: (options.direction === 'ascending') ? 'descending' : 'ascending',
      returnRows: true
    };
    if (options.startKey) {
      //
      // options.startKey defines the beginning of the range of permissable iteration.
      //
      viewOpts.endKey = options.startKey;
    }

    var dIt = new DocIterator.Iter(
      2 * pageSize + 1,
      designDoc,
      view,
      viewOpts
    );
    var p = dIt.next().then(
      //
      // Fufillment handler. Transform the pageRows obtained via iteration and
      // assemble into a page. Note, returned rows are backward. So, we have to reverse
      // the list.
      //
      function(pageRows) {
        if (pageRows && (pageRows.length > 1)) {
          //
          // At least one row, so at least a previous page exists.
          //
          log.debug(lp + 'Promise fulfilled, ' + pageRows.length + ' rows retrieved...');
          var reversed = pageRows.reverse();
          var start = (reversed.length > (pageSize+1)) ? reversed.length - pageSize - 1: 0;
          var tmpResult = rowsToPage(reversed, start, pageSize);
          if (opts.fullPageAtEnd && !tmpResult.cursors.previous && (tmpResult.items.length < pageSize)) {
            //
            // return a full page starting at the beginning.
            //
            return that.at();
          }
          else {
            return tmpResult;
          }
        }
        else {
          //
          // Note, even if we got ONE, we would have no results as that would
          // be the row at the current cursor. Hence, need more than one.
          //
          log.debug(lp + 'Promise fulfilled, but no rows retrieved!');
          throw new DocIterator.StopIteration();
        }
      },
      function(err) {
        log.debug(lp + 'Promise rejected...');
        if (err instanceof DocIterator.StopIteration) {
          throw err;
        }
        else if (err instanceof Error) {
          throw err;
        }
        else {
          throw new IterationError(err);
        }
      });
    return p;
  };

  this.next = function(cursor) {

    var lp = logPrefix.replace(': ', '.next: ');

    log.debug(lp + 'cursor - (' + cursor.key + ', ' + cursor.id + ').');

    var dIt = new DocIterator.Iter(
      2 * pageSize + 1,
      designDoc,
      view,
      {
        startKey: cursor.key,
        startKeyDocId: cursor.id,
        endKey: options.stopKey,
        transform: options.transform,
        filterSync: options.filterSync,
        direction: options.direction,
        returnRows: true
      });

    log.debug(lp + 'Iterator created!');

    var p = dIt.next().then(
      //
      // Fufillment handler. Transform the pageRows obtained via iteration and
      // assemble into a page. Note, returned rows are backward. So, we have to reverse
      // the list.
      //
      function(pageRows) {
        if (pageRows && (pageRows.length > pageSize)) {
          log.debug(lp + 'Promise fulfilled, ' + pageRows.length + ' rows retrieved...');
          return rowsToPage(pageRows, pageSize, pageSize);
        }
        else {
          //
          // Current page is less than pageSize, so there is NO next page.
          //
          log.debug(lp + 'Promise fulfilled, but no rows retrieved!');
          throw new DocIterator.StopIteration();
        }
      },
      function(err) {
        log.debug(lp + 'Promise rejected...');
        if (err instanceof DocIterator.StopIteration) {
          throw err;
        }
        else if (err instanceof Error) {
          throw err;
        }
        else {
          throw new IterationError(err);
        }
      });
    return p;
  };
};

function InvalidOptions() {
  this.name = 'InvalidOptions';
  this.message = 'options-error';
};

function IterationError(err) {
  this.name = 'IterationError';
  this.message = 'iteration-error';
  this.error = err;
}

function isCursor(cursor) {
  return (_.isObject(cursor) && _.has(cursor, 'key') && _.has(cursor, 'id') && _.isObject(cursor.key) && (_.isString(cursor.id) || (cursor.id === undefined)));
}

exports = module.exports = function(database, host, port) {

  config.database = database;
  config.host = host;
  config.port = port;

  DocIterator = DocIteratorModule(config.database, config.host, config.port);

  return {
    Pager: DocPager,
    StopIteration: DocIterator.StopIteration,
    IterationError: IterationError,
    isCursor: isCursor
  };
};

//
// Some helpers:
//

//
// cursor: Factory method to create a cursor object given key / id.
//
function cursor(key, id) {
  return {
    key: key,
    id: id
  };
};

//
// pageItem: Factory method to create a page item.
//
function pageItem(cursor, doc) {
  return {
    cursor: cursor,
    doc: doc
  };
};

//
// rowsToPage: Transform raw rows returned via a document iterator
//  to a page. Passed in rows should be in assending order. Where:
//
//  index === pageIndex - pageSize: start of previous page, iff (pageIndex - pageSize) >= 0).
//  index === pageIndex: start of current page.
//  index === pageIndex + pageSize: startof next page.
//
//  Note:
//    page.cursors.start, page.cursors.end, page.cursorce.previous and page.cursors.next 
//    are always returned, but maybe undefined.
//
function rowsToPage(rows, pageIndex, pageSize) {
  var page = {
    items: [],
    cursors: {
      start: undefined,
      end: undefined,
      previous: undefined,
      next: undefined
    }
  };
  if (rows && (rows.length > 0) && (pageIndex < rows.length)) {
    //
    // Have a page.
    //
    for (var i = pageIndex; (i < rows.length) && (i < (pageIndex + pageSize)); i++) {
      var row = rows[i];
      var c = cursor(row.key, row.id);

      page.items.push(pageItem(c, row.doc));
      if (i === pageIndex) {
        page.cursors.start = c;
      }
      else {
        page.cursors.end = c;
      }
    }
    if (0 < pageIndex) {
      page.cursors.previous = cursor(rows[0].key, rows[0].id);
    }
    if (rows.length > (pageIndex + pageSize)) {
      var row = rows[pageIndex + pageSize];
      page.cursors.next = cursor(row.key, row.id);
    }
  }
  return page;
};
