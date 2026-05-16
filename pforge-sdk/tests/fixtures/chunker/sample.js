function add(a, b) {
  return a + b;
}

class Calculator {
  constructor() {
    this.value = 0;
  }

  add(n) {
    this.value += n;
    return this;
  }
}

const multiply = (a, b) => {
  return a * b;
};

async function fetchData(url) {
  return null;
}
