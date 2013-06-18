# Persistent
Base class with common properties associated with documents which are to be persisted.
## Public Attributes
  * oid: Application assigned document ID. Used to find the document via the APIs.
  * app_id: In the context of the desktop application, the *<b>application ID</b>* of the instance of the application which last created or updated the document.
  * created_at: Timestamp, when document was first created.
  * updated_at: Timestamp, last document update.
  * in_trash: Boolean, is the document considered to be in "trash".
## Private Attributes
  * _storage: Object to store storage specific attributes.