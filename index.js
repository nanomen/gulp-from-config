/**
 * gulp-from-config
 * @author kystkysto
 * @copyright kystkysto 2015
 */

// Root path
var rootPath = process.cwd(),

// Npm modules
    gulp,
    path = require('path'),
    glob = require('glob'),
    browserify = require('browserify'),
    watchify = require('watchify'),
    fileExists = require('file-exists'),
    source = require('vinyl-source-stream'),
    buffer = require('vinyl-buffer'),
    minimist = require('minimist'),

// Gulp plugins
    gutil = require('gulp-util'),
    enviroments = [
        'dev',
        'test',
        'prod'
    ];


/**
 * Create gulp tasks
 * @access private
 * @returns {Array} tasks
 */
function addTasks(configs, taskCompletion) {

    var tasks = [],
        subTasks;

    configs.forEach(function (config) {

        var taskName = config.name;

        if(taskName) {

            subTasks = createTask(config, taskCompletion);
            gulp.task(taskName, subTasks, function(){});

            tasks.push(taskName);

        } else {
            gutil.log(gutil.colors.red('Error:'), 'task name must be set');
        }
    });

    return tasks;
}

/**
 * Create task procedures
 * @access private
 * @param {Object} config
 * @returns {Array}
 */
function createTask(config, taskCompletion) {

    var subTasks = [],
        subTaskName = '',
        storedTask = {},
        tmp = null;

    if(Array.isArray(config.subTasks) && config.subTasks.length) {

        config.subTasks.forEach(function (subTask) {

            tmp = checkForReuse(subTask, storedTask);

            subTask = tmp.current;
            storedTask = tmp.stored;

            if (!subTask.name) {
                subTask.name = randomTaskName();
            }

            subTaskName = config.name + ':' + subTask.name;

            if (isSubTaskValid(subTask)) {

                createSubTask(subTaskName, subTask, config.name, taskCompletion);

                subTasks.push(subTaskName);
            }

        });
    } else {

        gutil.log(gutil.colors.yellow('Warning:'), 'subTasks are not set');
    }

    return subTasks;
}

/**
 * Check if tilda used
 * @access private
 * @param {Object} config
 * @returns {Array}
 */
function checkForReuse(current, stored) {

    for(var prop in current) {

        if(current.hasOwnProperty(prop)) {

            if(current[prop] === '~') {

                current[prop] = stored[prop];

            } else if(prop === 'plugins') {

                current.plugins.forEach(function(currentPlugin, i) {

                    if(typeof currentPlugin === 'string' && currentPlugin.charAt(0) === '~') {

                        var pluginName = currentPlugin.slice(1);

                        stored.plugins.forEach(function(storedPlugin, y) {

                            if(storedPlugin.name === pluginName) {

                                current.plugins[i] = storedPlugin;
                            }
                        });
                    } else {

                        if(stored.plugins) {

                            stored.plugins.push(currentPlugin);
                        } else {

                            stored.plugins = [currentPlugin];
                        }
                    }
                });


            } else {

                stored[prop] = current[prop];
            }
        }
    }

    return {
        current: current,
        stored: stored
    };
}

/**
 * Check if subtask is valid
 * @access private
 * @param {Object} task
 * @returns {boolean}
 */
function isSubTaskValid(task) {

    if (
        (
            task.src === '~' ||
            (
                Object.keys(task.src).length &&
                Array.isArray(task.src.include) &&
                task.src.include.length
            )
        )
            &&
        (
            task.dest ||
            typeof task.dest === 'string'
        )
    ) {

        return true;
    } else {

        gutil.log(gutil.colors.red('Error:'),
            'src and dest must be set for',
            gutil.colors.cyan(subTaskName));

        return false;
    }
}

/**
 * Cretate sub tasks of task
 * @access private
 * @param {string} subTaskName
 * @param {Object} subTask
 */
function createSubTask(subTaskName, subTask, taskName, taskCompletion) {

    var subTaskWatch = taskName + ':watch:' + subTask.name,
        watchTaks = [];

    if (!subTask.browserify && typeof subTask.watch !== "undefined") {

        setWatch(subTaskName, subTaskWatch, subTask);
        watchTaks.push(subTaskWatch);
    }

    gulp.task(subTaskName, watchTaks, function (taskCompletion) {

        var task = {},
            dest = rootPath + subTask.dest;

        if(subTask.browserify) {

            task = setBrowserify(subTask.src, subTask, taskName, dest);
            task = runWatchifyTask(subTask, taskName, task, dest);

        } else {

            task = setSrc(subTask.src);

            task = setPipes(task, subTask.plugins, subTask.sourcemaps);

            task = task.pipe(gulp.dest(dest));

        }

        if(taskCompletion) {
            taskCompletion(subTask);
        }

        return task;
    }.bind(this, taskCompletion));
}

/**
 * Prepare source patshs
 * @access private
 * @param {Object} srcPaths
 * @returns Array
 */
function prepareSrc(srcPaths) {

    var src = [],
        include = [];

    if(Object.keys(srcPaths).length) {

        include = setFullPaths(srcPaths.include);

        src = src.concat(include);

        if(Array.isArray(srcPaths.exclude) && srcPaths.exclude.length) {

            srcPaths.exclude.forEach(function (path) {

                // Возможность использовать относительный путь
                //src.push('!' + rootPath + path);
                src.push('!' + path);
            });
        }
    }

    src.forEach(function(srcPath, i) {
        srcPath = minimizePath(srcPath);
        gutil.log('Src path' + i + ':', gutil.colors.magenta(srcPath));
    });

    return src;
}

/**
 * Cut rootPath from path
 * @access private
 * @param {string} path
 * @returns {string} path
 */
function minimizePath(path) {
    return path.replace(rootPath, '.');
}

/**
 * Set source paths
 * @access private
 * @param {Object} srcPaths
 * @returns {*}
 */
function setSrc(srcPaths) {

    var src = prepareSrc(srcPaths);

    return gulp.src(src);
}

/**
 * Set browserify
 * @access private
 * @param {Object} srcPaths
 * @param {Object} browserify
 * @param {string} taskName
 * @returns {*}
 */
function setBrowserify(srcPaths, subTask, taskName, dest) {

    var src = prepareSrc(srcPaths),
        entries = [],
        b = null;

    if(src.length) {

        gutil.log('Browserify enabled:', gutil.colors.blue(true));

        src.forEach(function(e) {
            entries = entries.concat(glob.sync(e));
        });

        var opt = {
            entries: entries,
            debug: true,
            cache: {},
            packageCache: {},
            fullPaths: false // скрываем абсолютные пути в require
        };

        b = browserify(opt);
        b = setTransforms(b, subTask.browserify.transforms);

        if(subTask.browserify.watchify) {

            gutil.log('Watchify enabled:', gutil.colors.blue(true));

            b = b.plugin(watchify);

            b = b.on('update', function(file) {

                console.log(file);
                gutil.log('File:', gutil.colors.magenta(file), 'was', gutil.colors.green('changed'));
                return runWatchifyTask(subTask, taskName, b, dest);

            });

            b = b.on('log', function(msg) {

                gutil.log('Watchify:', gutil.colors.green(msg));
            });

            b = b.on('error', function(err) {

                gutil.log(gutil.colors.red('Error:'), 'Browserify:', err.message);
            });
        }
    }

    return b;
}

/**
 * Prepare tsks for wathify
 * @param subTask
 * @param taskName
 * @param b
 * @param dest
 * @returns {*}
 */
function runWatchifyTask(subTask, taskName, b, dest) {

    var file = subTask.browserify.file || taskName + '.js';

    b = b.bundle();
    b = b.on('error', function(err) {

        gutil.log(gutil.colors.red('Error:'), 'Wathify:', err.message);
    });
    b = b.pipe(source(file));
    b = b.pipe(buffer());

    b = setPipes(b, subTask.plugins, subTask.sourcemaps);

    b = b.pipe(gulp.dest(dest));

    return b;
}

/**
 * Set browserify transforms
 * @access private
 * @param {Object} b
 * @param {Array} transforms
 * @returns {*}
 */
function setTransforms(b, transforms) {

    var transforms = requireTransforms(transforms);

    if(transforms.length) {

        transforms.forEach(function(transform) {

            b = b.transform(transform);
        });
    }

    return b;
}

/**
 * Require transform modules
 * @param transforms
 * @returns {Array}
 */
function requireTransforms(transforms) {

    var transfomsList = [];

    if(Array.isArray(transforms) && transforms.length) {

        transforms.forEach(function(t) {

            var plugin = null,
                transformName = t,
                transformation = null,
                optionsMsg = gutil.colors.yellow('no options');

            try {

                if(typeof t.name === 'string') {

                    transformName = t.name;
                }

                plugin = require(transformName);

                transformation = plugin;

                if(t.options && Object.keys(t.options).length) {

                    optionsMsg = t.options;
                    transformation = [plugin, t.options];
                }

                gutil.log('Transform:',  gutil.colors.green(transformName), 'with options:', optionsMsg);

                transfomsList.push(transformation);
            } catch (err) {

                if (err.code === 'MODULE_NOT_FOUND') {

                    gutil.log(gutil.colors.red('Error:'), 'Transform does not exist', gutil.colors.green(t));
                } else {

                    gutil.log(gutil.colors.red('Error:'), err.message);
                }
            }
        });
    }

    return transfomsList;
}

/**
 * Set watch task for subtask if enabled
 * @access private
 * @param {string} subTaskName
 * @param {string} subTaskWatch
 * @param {Object} subTask
 */
function setWatch(subTaskName, subTaskWatch, subTask) {

    var watch = [],
        task = {};

    watch = setWatchPaths(subTask);

    gulp.task(subTaskWatch, function() {

        watch.forEach(function(watchPath, i) {
            watchPath = minimizePath(watchPath);
            gutil.log('Watching path' + i + ':', gutil.colors.magenta(watchPath));
        });

        task = gulp.watch(watch, [subTaskName])

            .on('change', function(event) {
                gutil.log('File:', gutil.colors.magenta(event.path), 'was', gutil.colors.green(event.type));
            });

        return task;
    });
}

/**
 * Set watch paths
 * @access private
 * @param {Object} subTask
 * @returns {Array}
 */
function setWatchPaths(subTask) {

    var watch = [],
        include = [],
        exclude = [];

    if(Array.isArray(subTask.watch) && subTask.watch.length) {

        watch = watch.concat(setFullPaths(subTask.watch));
    } else if(subTask.watch === true) {

        include = setFullPaths(subTask.src.include);
        exclude = setFullPaths(subTask.src.exclude);

        watch = watch.concat(include, exclude);
    } else {


    }

    return watch;
}

/**
 * Set absoulute paths
 * @access private
 * @param {Array} src
 * @returns {Array}
 */
function setFullPaths(paths) {

    var _paths = [];

    if(paths instanceof Array) {

        paths.forEach(function(path) {

            // Возможность использовать относительный путь
            //_paths.push(rootPath + path);
            _paths.push(path);
        });
    }

    return _paths;
}

/**
 * Set pipes
 * @access private
 * @param {Object} task
 * @param {bolean} sourcemaps
 * @param {Array} plugins
 * @returns {*}
 */
function setPipes(task, plugins, sourcemaps) {

    if(Array.isArray(plugins) && plugins.length) {

        gutil.log('Sourcemap enabled:', gutil.colors.blue(sourcemaps));

        task = setSourceMaps(task, sourcemaps, plugins);
    } else {
        gutil.log(gutil.colors.yellow('Warning:'), 'no plugins');
    }

    return task;
}

/**
 * Set sourcemaps for proceded files
 * @access private
 * @param {Object} task
 * @param {bolean} sourcemaps
 * @param {Array} plugins
 * @returns {*}
 */
function setSourceMaps(task, sourcemaps, plugins) {

    var pipe = null;

    if(sourcemaps) {
        pipe = pluginExist('gulp-sourcemaps');
    }

    if(pipe) {
        task = task.pipe(pipe.init({loadMaps: true}));
    }

    task = setPlugins(task, plugins);


    if(pipe) {
        task = task.pipe(pipe.write('./maps'));


    }

    return task;
}

/**
 * Set plugins into task pipes
 * @access private
 * @param {Object} task
 * @param {Array} plugins
 * @returns {*}
 */
function setPlugins(task, plugins) {

    plugins.forEach(function(plugin, i) {

        gutil.colors.yellow('no options');

        var sourcePlugin = pluginExist(plugin.name);

        if(sourcePlugin) {

            task = task.pipe(sourcePlugin(plugin.options));

            gutil.log('Plugin:',
                gutil.colors.green(plugin.name),
                'with options:',
                plugin.options || gutil.colors.yellow('no options')
            );
        } else {

            gutil.log(gutil.colors.red('Error:'), 'Plugin', gutil.colors.green(plugin.name), 'not found');
        }
    });

    return task;
}


/**
 * Check if plugin exists
 * @access private
 * @param {String} pluginName
 * @returns {Function}
 */
function pluginExist(pluginName) {

    try {
        return require(pluginName);
    } catch(err) {
        return false;
    }
}

/**
 * Get list of all *.json and *.js config files
 * @access private
 * @param {String} configsPath
 * @returns {Array}
 */
function getConfigFiles(configsPath) {

    var files = glob.sync(configsPath + '/**/*.{json,js}');

    return files;

}

/**
 * Get content of each config file
 * @access private
 * @param {string} fileName
 * @returns {Object}
 */
function getConfigFromFile(fileName) {

    if(!fileExists(fileName)) {

        gutil.log(gutil.colors.red('Error:'), 'config file doesn\'t exist');
        return false;
    }

    return require(fileName);
}


/**
 * Generate random string for task name
 * @access private
 * @returns {string}
 */
function randomTaskName() {

    return Math.random().toString(36).substring(7);
}


/**
 * Validate task configs
 * @access private
 * @param {Array} configs
 * @returns {Array} configs - array with configuration objects
 * @example
 * [
 *   {
 *     name: "taskName",
 *       subTasks: [
 *       {
 *         name: "script",
 *         dest: "/dest/scripts",
 *         sourcemaps: true,
 *         src: {
 *           include: [
 *             "src/scripts/*.js"
 *           ]
 *         },
 *         plugins: [
 *           {
 *             name: "concat",
 *             options: "app.js"
 *           }
 *         ]
 *       }
 *     ]
 *   }
 * ]
 */
function setConfigs(configs, env) {

    var _configs = [];

    if(Array.isArray(configs) && configs.length) {

        configs.filter(function(config) {

            if (!Object.keys(config).length) {

                gutil.log(gutil.colors.yellow('Warning:'), 'empty config is passed');
                return false;
            }


            _configs.push(setConfigEnvironment(config, env));

            return true;

        });


        return _configs;
    } else {

        gutil.log(gutil.colors.red('Error:'),'must be array of configuration objects');
        process.exit(1);
    }
}

/**
 * Will filter only enviromental options from config
 * @param config
 * @param env
 * @returns {*}
 */
function setConfigEnvironment(config, env) {

    var subTasks = config.subTasks;

    subTasks.forEach(function (task) {

        for(item in task) {

            if(hasEnviromentInItem(task[item])) {

                task[item] = selectEnviroment(task[item], env);
            } else if(item === 'plugins' && task['plugins'] !== '~') {

                task['plugins'] = getEnviromentPlugins(task['plugins'], env);
            }
        }
    });

    return config;
}

/**
 * Will return only enviromtnal plugions
 * @param plugins
 * @param env
 * @returns {*|{TAG, CLASS, ATTR, CHILD, PSEUDO}|Array.<T>}
 */
function getEnviromentPlugins(plugins, env) {

    plugins = plugins.filter(function (plugin) {

        if(plugin.env && plugin.env !== env) {

            return false;
        } else {

            return true;
        }
    });

    plugins.forEach(function (plugin) {

        if(plugin['options']) {

            plugin['options'] = getEnviromentFromPluginOptions(plugin['options']);
        }
    });

    return plugins;
}

/**
 * Will return plugin options for enviroment
 * @param options
 * @param env
 * @returns {*}
 */
function getEnviromentFromPluginOptions(options, env) {

    if(hasEnviromentInItem(options)) {

        options = selectEnviroment(options, env);
    }

    return options;
}

/**
 * Will select enviroment option or any first enviroment
 * @param items
 * @param env
 */
function selectEnviroment(item, env) {

    if(item[env]) {

        item = item[env];
    } else {

        item = item[Object.keys(item)[0]];
    }

    return item;
}

/**
 * Will check if enviroment variable exist in object
 * @param item
 * @returns {boolean}
 */
function hasEnviromentInItem(item) {

    for (var i = 0; i < enviroments.length; i++) {

        if (item[enviroments[i]]) {

            return true;
            break;
        }

        return false;
    }
}
/**
 * Parse configs content
 * @access public
 * @param {String} configsPath - path to configurations
 * @returns {Array} configs - array with configuration objects
 */
function getConfigs(configsPath) {

    var configs = [],
        configsPath = configsPath ? path.join(rootPath, configsPath) : path.join(rootPath, 'configs'),
        files = getConfigFiles(configsPath);


    if(Array.isArray(files) && files.length) {

        files.forEach(function(file) {

            var config = getConfigFromFile(file);

            if(config) {

                configs.push(config);
            }
        });
    }

    return configs;
}
/**
 * Define and return tasks
 * @access public
 * @param {Object} gulp - instanse of gulp
 * @param {Array} configs - array with configuration objects
 * @param {Array} taskCompletion - callbacj on task compleation
 * @returns {Array} tasks - array of all tasks
 */
function createTasks(gulpInstance, configs, taskCompletion) {

    var argv = minimist(process.argv),
        env = argv.env || 'dev';

    if(argv.env) {
        gutil.log('Environment is set to:', gutil.colors.blue(env));
    }

    // Gulp
    gulp = gulpInstance;

    var __configs = setConfigs(configs, env),
        taskCompletion = taskCompletion || function(config) {};

    return addTasks(__configs, taskCompletion);
}

module.exports = {
    getConfigs: getConfigs,
    createTasks: createTasks
};