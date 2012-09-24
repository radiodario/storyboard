(function(global, _) {

  var Miso = global.Miso = (global.Miso || {});
  var Util = Miso.Util;

  var Scene = Miso.Scene = function( config ) {
    config = config || {};
    this._context = config.context || this;
    this._id = _.uniqueId('scene');

    if ( config.children ) { //has child scenes
      this._buildChildren( config.children );
      this._initial = config.initial;
      this.to = children_to;

    } else { //leaf scene

      this.handlers = {};
      _.each(Scene.HANDLERS, function(action) {
        
        config[action] = config[action] || function() { return true; };
        
        //wrap functions so they can declare themselves as optionally
        //asynchronous without having to worry about deferred management.
        this.handlers[action] = Util._wrap(config[action]);
      
      }, this);
      this.to = leaf_to;
    }

    _.each(config, function(prop, name) {
      if (_.indexOf(Scene.BLACKLIST, name) !== -1) { return; }
      this[name] = prop;
    }, this);

  };

  Scene.HANDLERS = ['enter','exit'];
  Scene.BLACKLIST = ['initial','children','enter','exit','context'];

  _.extend(Scene.prototype, Miso.Events, {
    attach : function(name, parent) {
      this.name = name;
      this.parent = parent;
      //if the parent has a custom context the child should inherit it
      if (parent._context && (parent._context._id !== parent._id)) {
        this._context = parent._context;
        if (this.children) {
          _.each(this.children, function(scene, name) {
            scene.attach(scene.name, this);
          }, this);
        }
      }
    },

    start : function() {
      //if we've already started just return a happily resoved deferred
      return this._current ? _.Deferred().resolve() : this.to(this._initial);
    },

    cancelTransition : function() {
      this._complete.reject();
      this._transitioning = false;
    },

    scene : function() {
      return this._current ? this._current.name : null;
    },

    is : function( scene ) {
      return (scene === this._current.name);
    },

    inTransition : function() {
      return (this._transitioning === true);
    },

    _buildChildren: function( scenes ) {
      this.children = {};
      _.each(scenes, function(scene, name) {
        this.children[name] = scene instanceof Miso.Scene ? scene : new Miso.Scene(scene);
        this.children[name].attach(name, this);
      }, this);
    }
  });

  //Used as the to function to scenes which do not have children
  function leaf_to( sceneName, argsArr, deferred ) {
    this._transitioning = true;
    var complete = this._complete = deferred || _.Deferred(),
    args = argsArr ? argsArr : [],
    handlerComplete = _.Deferred()
      .done(_.bind(function() {
        this._transitioning = false;
        this._current = sceneName;
        complete.resolve();
      }, this))
      .fail(_.bind(function() {
        this._transitioning = false;
        complete.reject();
      }, this));

    this.handlers[sceneName].call(this._context, handlerComplete, args);

    return complete.promise();
  }

  function children_to( sceneName, argsArr, deferred ) {
    var toScene = this.children[sceneName],
        fromScene = this._current,
        args = argsArr ? argsArr : [],
        complete = this._complete = deferred || _.Deferred(),
        exitComplete = _.Deferred(),
        enterComplete = _.Deferred(),
        publish = _.bind(function(name) {
          this.publish(name, (fromScene ? fromScene.name : null), toScene.name);
        }, this),
        bailout = _.bind(function() {
          this._transitioning = false;
          complete.reject();
          publish('fail');
        }, this),
        success = _.bind(function() {
          this._transitioning = false;
          this._current = toScene;
          complete.resolve();
          publish('done');
        }, this);

    //Can't fire a transition that isn't defined
    if (!toScene) {
      throw "Scene '" + sceneName + "' not found!";
    }

    publish('start');

    //we in the middle of a transition?
    if (this._transitioning) { 
      return complete.reject();
    }

    this._transitioning = true;

      
    //initial event so there's no from scene
    if (!fromScene) {
      exitComplete.resolve();
      toScene.to('enter', args, enterComplete)
      .fail(bailout);
    } else {
      //run before and after in order
      //if either fail, run the bailout
      fromScene.to('exit', args, exitComplete)
      .done(function() {
        toScene.to('enter', args, enterComplete).fail(bailout);
      })
      .fail(bailout);
    }

    //all events done, let's tidy up
    _.when(exitComplete, enterComplete).then(success);

    return complete.promise();
  }


}(this, _));
