export const jsonTransform = {
  virtuals: true,
  versionKey: false,
  transform: (_document, value) => {
    value.id = String(value._id);
    delete value._id;
    return value;
  },
};
