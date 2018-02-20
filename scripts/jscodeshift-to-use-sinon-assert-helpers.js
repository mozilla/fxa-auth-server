
const path = require('path')

module.exports = function transformer(file, api) {

  const j = api.jscodeshift;
  const root = j(file.source);

  // Replace imports of 'insist' or 'assert' with our local assertion lib.

  root.find(j.CallExpression, {
    callee: {
      name: 'require'
    }
  })
  .filter(e => {
    return e.value.arguments.length == 1
      && e.value.arguments[0].type == 'Literal'
      && (e.value.arguments[0].value === 'insist' || e.value.arguments[0].value === 'assert')
  })
  .replaceWith(e => {
    const backRefs = [];
    let fileDir = path.dirname(file.path);
    while (path.basename(fileDir) !== 'test') {
      backRefs.push('..')
      fileDir = path.dirname(fileDir);
    }
    const relPath = backRefs.length ? backRefs.join('/') + '/' : './';
    return j.callExpression(e.value.callee, [j.literal(relPath + 'assert')]);
  })

  // Replace assert.equal(foo.callCount, N) with helper methods.

  root.find(j.CallExpression, {
    callee: {
      object: { name: 'assert' },
      property: { name: 'equal' }
    }
  })
  .filter(e => {
    return e.value.arguments.length >= 2
      && e.value.arguments[0].type == 'MemberExpression'
      && e.value.arguments[0].property.type == 'Identifier'
      && e.value.arguments[0].property.name == 'callCount'
      && e.value.arguments[1].type == 'Literal'
  })
  .forEach(e => {
    switch (e.value.arguments[1].value) {
      case 0:
        e.get('callee', 'property').replace(j.identifier('notCalled'))
        e.get('arguments').replace([e.value.arguments[0].object])
        break
      case 1:
        e.get('callee', 'property').replace(j.identifier('calledOnce'))
        e.get('arguments').replace([e.value.arguments[0].object])
        break
      case 2:
        e.get('callee', 'property').replace(j.identifier('calledTwice'))
        e.get('arguments').replace([e.value.arguments[0].object])
        break
      case 3:
        e.get('callee', 'property').replace(j.identifier('calledThrice'))
        e.get('arguments').replace([e.value.arguments[0].object])
        break
      default:
        e.get('callee', 'property').replace(j.identifier('callCount'))
        e.get('arguments').replace([e.value.arguments[0].object, e.value.arguments[1]])
    }
  })

  // Replace sequences like:
  //   args = foo.args[0]
  //   assert.equal(args.length, 2)
  //   assert.equal(args[0], bar)
  //   assert.equal(args[1], baz)
  // With an equivalent call to assert.calledWithExactly()

  root.find(j.ExpressionStatement)
  .filter(e => {
    return e.value.expression.type === 'AssignmentExpression'
      && e.value.expression.left.type === 'Identifier'
      && e.value.expression.left.name === 'args'
      && e.value.expression.right.type === 'MemberExpression'
      && e.value.expression.right.property.type == 'Literal'
      && e.value.expression.right.object.type === 'MemberExpression'
      && e.value.expression.right.object.property.type === 'Identifier'
      && e.value.expression.right.object.property.name === 'args'
  }).forEach(e => {
    const p = e.parent
    let idx = e.name
    let numArgs, argValues = [], argChecks = []
    while (true) {
      let argCheck = p.value.body[++idx]
      if (argCheck.type !== 'ExpressionStatement') { break }
      if (argCheck.expression.type !== 'CallExpression' || argCheck.expression.callee.object.name !== 'assert') { break }
      if (['equal', 'deepEqual'].indexOf(argCheck.expression.callee.property.name) === -1) { break }
      if (argCheck.expression.arguments[0].type !== 'MemberExpression') { break }
      if (argCheck.expression.arguments[0].object.name !== 'args') { break }
      argChecks.push(argCheck)
      if (argCheck.expression.arguments[0].property.name === 'length') {
        numArgs = argCheck.expression.arguments[1].value
      } else {
        argValues[argCheck.expression.arguments[0].property.value] = argCheck.expression.arguments[1]
      }
    }
    if (numArgs === argValues.length) {
      // To maintain formatting, we mutate available nodes in-place.
      idx--
      while (idx > e.name + 1) {
        p.get('body', idx).replace()
        idx--
      }
      p.get('body', e.name + 1, 'expression', 'callee', 'property').replace(j.identifier('calledWithExactly'))
      p.get('body', e.name + 1, 'expression', 'arguments').replace([e.value.expression.right.object.object].concat(argValues))
      p.get('body', e.name).replace()
    }
  })

  root.find(j.VariableDeclaration)
  .filter(e => {
    return e.value.declarations.length === 1
      && e.value.declarations[0].id.name === 'args'
      && e.value.declarations[0].init.type === 'MemberExpression'
      && e.value.declarations[0].init.property.type == 'Literal'
      && e.value.declarations[0].init.object.type === 'MemberExpression'
      && e.value.declarations[0].init.object.property.type === 'Identifier'
      && e.value.declarations[0].init.object.property.name === 'args'
  }).forEach(e => {
    const p = e.parent
    let idx = e.name
    let numArgs, argValues = [], argChecks = []
    while (true) {
      let argCheck = p.value.body[++idx]
      if (argCheck.type !== 'ExpressionStatement') { break }
      if (argCheck.expression.type !== 'CallExpression' || argCheck.expression.callee.object.name !== 'assert') { break }
      if (['equal', 'deepEqual'].indexOf(argCheck.expression.callee.property.name) === -1) { break }
      if (argCheck.expression.arguments[0].type !== 'MemberExpression') { break }
      if (argCheck.expression.arguments[0].object.name !== 'args') { break }
      argChecks.push(argCheck)
      if (argCheck.expression.arguments[0].property.name === 'length') {
        numArgs = argCheck.expression.arguments[1].value
      } else {
        argValues[argCheck.expression.arguments[0].property.value] = argCheck.expression.arguments[1]
      }
    }
    if (numArgs === argValues.length) {
      // To maintain formatting, we mutate available nodes in-place.
      idx--
      while (idx > e.name + 1) {
        p.get('body', idx).replace()
        idx--
      }
      p.get('body', e.name + 1, 'expression', 'callee', 'property').replace(j.identifier('calledWithExactly'))
      p.get('body', e.name + 1, 'expression', 'arguments').replace([e.value.declarations[0].init.object.object].concat(argValues))
      p.get('body', e.name).replace()
    }
  })

  return root.toSource();
};

if (require.main === module) {
  const cp = require('child_process')
  const cmd = ['jscodeshift', '--run-in-band', '-t', __filename, path.join(__dirname, '..', 'test', 'local')]
  cp.execSync(cmd.join(' '))
}
