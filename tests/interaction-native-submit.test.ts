import test from 'node:test';
import assert from 'node:assert/strict';
import { mountInteractionSequences } from '../src/stichos/interaction-sequence.ts';

class Surface {
  handlers = new Map<string, (event: any) => void>();
  isConnected = true;
  addEventListener(type: string, handler: (event: any) => void) {
    this.handlers.set(type, handler);
  }
  removeEventListener(type: string) {
    this.handlers.delete(type);
  }
  closest() {
    return this;
  }
}
class Form {
  elements: (Input | Button)[] = [];
}
class Input extends Surface {
  type = 'text';
  disabled = false;
  form: Form | null = null;
}
class Button extends Surface {
  type = 'submit';
  disabled = false;
  form: Form | null = null;
}
class Textarea extends Surface {
  form: Form | null = null;
}

test('native Enter submission retains its originating form, default button and input epoch', (t) => {
  const root = new Surface(),
    document = new Surface();
  for (const [key, value] of Object.entries({
    Element: Surface,
    HTMLElement: Surface,
    HTMLInputElement: Input,
    HTMLButtonElement: Button,
    document,
    addEventListener() {},
    removeEventListener() {},
  })) {
    const prior = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true });
    t.after(() =>
      prior
        ? Object.defineProperty(globalThis, key, prior)
        : Reflect.deleteProperty(globalThis, key),
    );
  }
  const sequences = mountInteractionSequences(root as unknown as HTMLElement);
  const form = new Form(),
    input = new Input(),
    submit = new Button();
  input.form = submit.form = form;
  form.elements = [input, submit];
  const press = (target: Surface, key = 'Enter') =>
    root.handlers.get('keydown')!({ target, key, repeat: false });
  const click = (target: Surface) => {
    let prevented = false;
    root.handlers.get('click')!({
      target,
      detail: 0,
      pointerId: -1,
      preventDefault() {
        prevented = true;
      },
      stopImmediatePropagation() {},
    });
    return !prevented;
  };

  press(input);
  assert.equal(
    click(submit),
    true,
    'HTML implicit submission clicks the default button, not the focused input',
  );
  press(submit);
  assert.equal(click(submit), true, 'Explicit focused-button activation still works');

  press(input, ' ');
  assert.equal(click(submit), false, 'Space typed in an input cannot activate its form');
  const textarea = new Textarea();
  textarea.form = form;
  press(textarea);
  assert.equal(click(submit), false, 'Enter in a textarea is a line break');
  input.type = 'checkbox';
  press(input);
  assert.equal(click(submit), false, 'Non-text inputs cannot inherit an implicit-submit exception');
  input.type = 'text';

  press(input);
  sequences.transition();
  assert.equal(click(submit), false, 'Changing the input surface invalidates even the same form');
  press(input);
  const replacement = new Button();
  replacement.form = form;
  form.elements = [input, replacement];
  assert.equal(click(replacement), false, 'A replacement submitter never inherits a held key');

  form.elements = [input, submit];
  press(input);
  const other = new Form();
  other.elements = [input, submit];
  input.form = submit.form = other;
  assert.equal(
    click(submit),
    false,
    'Moving both controls to another form still loses the original owner',
  );
  input.form = submit.form = form;
  press(input);
  submit.disabled = true;
  assert.equal(click(submit), false, 'A disabled submitter cannot be activated after keydown');
  submit.disabled = false;
  press(input);
  input.isConnected = false;
  assert.equal(click(submit), false, 'Detached source inputs cannot submit a replacement screen');
  input.isConnected = true;
  press(input);
  assert.equal(click(submit), true, 'A fresh Enter recovers without a timer or debounce');
  sequences.dispose();
});
