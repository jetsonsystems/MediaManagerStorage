# MediaManagerStorage/lib/touchdb

Interface to TouchDB.

The current assumption is that we are talking to TouchDB via our web-service, MediaManagerTouchServ, which embeds TouchDB.

## Usage
By default, loading [MediaManagerStorage](../../README.md) and invoking its getter *<b>get</b>* method to retrieve a storage sub-module returns an instance of a TouchDB module.

    var config = requre('MediaManagerAppConfig');
    var touchdb = require('MediaManagerStorage')(config.db).get();

The module is a Singleton, hence the first time it is required with a config, that is what will be used. Subsequently a require of the module can leave out the config parameter, and the singleton is returned.

It can also be explicity loaded:

    var touchdb = require('MediaManagerStorage')(config.db).get('touchdb')

##  Public Module Attributes

  * config: The DB config used during instantiation.

##  Methods exposed via the module

  * *<b>docFactory(\<class name\>)</b>*: Factory for creating documents with any appropriate initial state for attributes.
  * *<b>sync</b>*: Perform a 2 way syncronization between the local TouchDB instance and a remote CouchDB instance. Returns a synchronizer which is an event emitter.
  * *<b>syncState(id)</b>*: Return the state of a synchronization. Returns a Synchronizer instance, but it is a passive instance (returns NO events). This is solely here to support polling of a synchronization initiated via sync().
  * *<b>changesFeed(options)</b>*: Returns a changes feed.
  
## Data Model

Documents stored in TouchDB / CouchDB have a JSON representation. A new JSON document which can latter be persisted can be created via the *<b>docFactory</b>* method. Each document is identified by a *<b>class_name</b>* attribute. To construct a new document in memory simply invoke the factory method as follows:

    docFactory(<class name>)

For example, to create a new *image* document:

    var image = touchdb.docFactory('plm.Image');

The [data-model](../data-model/README.md) module contains a collection of document models which are utilized and persistend to TouchDB / CouchDB. See the [data-model README](../data-model/README.md) for specifics on the flavors of documents as identified by their *<b>class_name</b>* attribut.




