def add(a, b):
    return a + b

class Calculator:
    def __init__(self):
        self.value = 0

    def add(self, n):
        self.value += n
        return self

def multiply(a, b):
    return a * b
