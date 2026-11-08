// A member's code: three or four words and two digits. Must accept everything the Worker's newCode() makes.
export const isCode = (s) => /^[a-z]+[-\s_]+[a-z]+[-\s_]+[a-z]+(?:[-\s_]+[a-z]+)?[-\s_]+\d{2}$/i.test(s);
