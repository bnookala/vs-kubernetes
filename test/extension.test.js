/* global suite, test */

//
// Note: This example test is leveraging the Mocha test framework.
// Please refer to their documentation on https://mochajs.org/ for help.
//

var fs = require('fs');
var path = require('path');

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
// var vscode = require('vscode');
// var extension = require('../extension');
var explainer = require('../out/src/explainer');  // TODO: TyyyypppeeScriippptt!!!
var textassert = require('../out/test/textassert');

// Defines a Mocha test suite to group tests of similar kind together
suite("Extension Tests", function() {

    var swaggerJson = fs.readFileSync(path.join(__dirname, 'kube-swagger.json'), 'utf8');
    var swagger = JSON.parse(swaggerJson);

    test("Kind documentation includes kind name - Deployment", function() {
        var expl = explainer.readExplanation(swagger, 'Deployment');
        textassert.startsWith('Deployment:', expl);
    });

    test("Kind documentation includes description - Deployment", function() {
        var expl = explainer.readExplanation(swagger, 'Deployment');
        textassert.includes('Deployment enables declarative updates for Pods and ReplicaSets', expl);
    });

    test("Kind documentation includes properties - Deployment", function() {
        var expl = explainer.readExplanation(swagger, 'Deployment');
        textassert.includes('**apiVersion** (string)', expl);
        textassert.includes('APIVersion defines the versioned schema', expl);
        textassert.includes('**spec** (object)', expl);
        textassert.includes('Standard object metadata', expl);
    });

    test("Property search ignores kind case", function() {
        var expl = explainer.readExplanation(swagger, 'deployment.metadata');
        textassert.startsWith('metadata:', expl);
    });

    test("Nonterminal documentation includes title - Deployment.metadata", function() {
        var expl = explainer.readExplanation(swagger, 'Deployment.metadata');
        textassert.startsWith('metadata:', expl);
    });

    test("Nonterminal documentation includes description - Deployment.metadata", function() {
        var expl = explainer.readExplanation(swagger, 'Deployment.metadata');
        textassert.includes('Standard object metadata', expl);
    });

    test("Nonterminal documentation includes type description - Deployment.metadata", function() {
        var expl = explainer.readExplanation(swagger, 'Deployment.metadata');
        textassert.includes('ObjectMeta is metadata that all persisted resources must have', expl);
    });

    test("Nonterminal documentation includes properties - Deployment.metadata", function() {
        var expl = explainer.readExplanation(swagger, 'Deployment.metadata');
        textassert.includes('**finalizers** (string[])', expl);
        textassert.includes('Must be empty before the object is deleted from the registry', expl);
        textassert.includes('**uid** (string)', expl);
        textassert.includes('UID is the unique in time and space value for this object', expl);
    });

    test("Terminal primitive documentation includes title - Deployment.metadata.generation", function() {
        var expl = explainer.readExplanation(swagger, 'Deployment.metadata.generation');
        textassert.startsWith('**generation** (integer)', expl);
    });

    test("Terminal primitive documentation includes description - Deployment.metadata.generation", function() {
        var expl = explainer.readExplanation(swagger, 'Deployment.metadata.generation');
        textassert.includes('A sequence number representing', expl);
    });

    test("Terminal ref-to-primitive documentation includes title - Deployment.metadata.creationTimestamp", function() {
        var expl = explainer.readExplanation(swagger, 'Deployment.metadata.creationTimestamp');
        textassert.startsWith('**creationTimestamp** (string)', expl);
    });

    test("Terminal ref-to-primitive documentation includes description - Deployment.metadata.creationTimestamp", function() {
        var expl = explainer.readExplanation(swagger, 'Deployment.metadata.creationTimestamp');
        textassert.includes('CreationTimestamp is a timestamp representing the server time', expl);
    });

    test("KVP documentation reflects KVP collection - Deployment.metadata.annotations.deployment.kubernetes.io/revision", function() {
        var expl = explainer.readExplanation(swagger, 'Deployment.metadata.annotations.deployment.kubernetes.io/revision');
        textassert.startsWith('**annotations** (object)', expl);
        textassert.includes('Annotations is an unstructured key value map', expl);
    });

    test("Nonexistent field on rich type reports error - Deployment.metadata.biscuits", function() {
        var expl = explainer.readExplanation(swagger, 'Deployment.metadata.biscuits');
        textassert.startsWith("**biscuits:** field does not exist", expl);
    });

    test("Nonexistent field on primitive type is treated as parent - Deployment.metadata.generation.biscuits", function() {
        // This may seem odd but it's the way kubectl does it!
        var expl = explainer.readExplanation(swagger, 'Deployment.metadata.generation.biscuits');
        textassert.startsWith('**generation** (integer)', expl);
        textassert.includes('A sequence number representing', expl);
    });

});